// Firestore REST adapter for the isolated QA inbox.
// Reads and writes use the same transaction to preserve authorization and atomicity.
const PROJECT = 'atrio-catolico-qa-general';
const DATABASE = 'projects/' + PROJECT + '/databases/(default)';
const DOCUMENTS = DATABASE + '/documents';
const API = 'https://firestore.googleapis.com/v1/';

function decode(value) {
  if ('timestampValue' in value) {
    const ms = Date.parse(value.timestampValue);
    return {toMillis: () => ms};
  }
  if ('integerValue' in value) return Number(value.integerValue);
  if ('stringValue' in value) return value.stringValue;
  if ('booleanValue' in value) return value.booleanValue;
  if ('nullValue' in value) return null;
  if ('mapValue' in value) return fields(value.mapValue.fields);
  if ('arrayValue' in value) return (value.arrayValue.values ?? []).map(decode);
  throw Error('unsupported_inbox_field');
}

function fields(input = {}) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, decode(value)]));
}

function encode(value) {
  if (value === null) return {nullValue: null};
  if (typeof value === 'string') return {stringValue: value};
  if (typeof value === 'boolean') return {booleanValue: value};
  if (Number.isSafeInteger(value)) return {integerValue: String(value)};
  if (typeof value?.toMillis === 'function') {
    return {timestampValue: new Date(value.toMillis()).toISOString()};
  }
  if (Array.isArray(value)) return {arrayValue: {values: value.map(encode)}};
  if (value && typeof value === 'object') return {mapValue: {fields: encodeFields(value)}};
  throw Error('unsupported_inbox_write_field');
}

function encodeFields(input) {
  return Object.fromEntries(Object.entries(input).map(([key, value]) => [key, encode(value)]));
}

function leafPaths(data, prefix = '') {
  return Object.entries(data).flatMap(([key, value]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key)) throw Error('invalid_inbox_field_path');
    const path = prefix + key;
    return value && Object.getPrototypeOf(value) === Object.prototype &&
      !('toMillis' in value) && Object.keys(value).length ? leafPaths(value, path + '.') : [path];
  });
}

function documentRef(path) {
  return {path, collection: name => ({doc: id => documentRef(path + '/' + name + '/' + id)})};
}

function snapshot(name, document, readTime) {
  const path = name.slice(DOCUMENTS.length + 1);
  const ms = Date.parse(readTime);
  if (!name.startsWith(DOCUMENTS + '/') || !Number.isFinite(ms)) {
    throw Error('invalid_inbox_snapshot');
  }
  return {
    id: path.split('/').at(-1),
    ref: documentRef(path),
    exists: Boolean(document),
    readTime: {toMillis: () => ms},
    data: () => document ? fields(document.fields) : undefined,
    get: key => document ? fields(document.fields)[key] : undefined,
  };
}

export function createQaInboxFirestore(accessToken) {
  async function post(endpoint, body) {
    const response = await fetch(API + endpoint, {
      method: 'POST',
      headers: {Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json'},
      body: JSON.stringify(body),
    });
    if (!response.ok) throw Error('inbox_firestore_unavailable');
    return response.json();
  }

  return {
    doc: documentRef,
    collection(path) {
      const parts = path.split('/');
      const collectionId = parts.pop();
      const parent = [DOCUMENTS, ...parts].join('/');
      const query = {from: [{collectionId}], orderBy: []};
      return {
        parent,
        query,
        where(fieldPath, operator, value) {
          if (operator !== '>' || !Number.isSafeInteger(value)) throw Error('invalid_inbox_filter');
          query.where = {fieldFilter: {
            field: {fieldPath}, op: 'GREATER_THAN', value: {integerValue: String(value)},
          }};
          return this;
        },
        orderBy(fieldPath) {
          query.orderBy.push({field: {fieldPath}, direction: 'ASCENDING'});
          return this;
        },
        limit(limit) {
          query.limit = limit;
          return this;
        },
        startAfter(expiry, chatId) {
          query.startAt = {before: false, values: [
            {integerValue: String(expiry)}, {referenceValue: parent + '/' + collectionId + '/' + chatId},
          ]};
          return this;
        },
      };
    },
    async runTransaction(read, options) {
      const readOnly = options?.readOnly === true;
      const result = await post(DOCUMENTS + ':beginTransaction', {
        options: readOnly ? {readOnly: {}} : {readWrite: {}},
      });
      const transaction = result.transaction;
      if (typeof transaction !== 'string' || !transaction) throw Error('inbox_transaction_missing');
      const writes = [];
      const name = ref => DOCUMENTS + '/' + ref.path;
      function write(operation) {
        if (readOnly || writes.length >= 100) throw Error('inbox_write_not_allowed');
        writes.push(operation);
      }
      function put(ref, data, {mask, exists} = {}) {
        const operation = {update: {name: name(ref), fields: encodeFields(data)}};
        if (mask) operation.updateMask = {fieldPaths: mask};
        if (exists !== undefined) operation.currentDocument = {exists};
        write(operation);
      }
      const tx = {
          create(ref, data) { put(ref, data, {exists: false}); },
          update(ref, data) { put(ref, data, {exists: true, mask: Object.keys(data)}); },
          set(ref, data, opts) {
            const mask = opts?.merge ? leafPaths(data) : undefined;
            put(ref, data, {mask});
          },
          delete(ref) { write({delete: name(ref)}); },
          async getAll(...refs) {
            if (refs.length === 0) return [];
            const documents = refs.map(({path}) => DOCUMENTS + '/' + path);
            const rows = await post(DOCUMENTS + ':batchGet', {documents, transaction});
            const byName = new Map();
            for (const row of rows) {
              const name = row.found?.name ?? row.missing;
              if (!documents.includes(name) || byName.has(name) ||
                  Boolean(row.found) === Boolean(row.missing)) throw Error('invalid_inbox_batch');
              byName.set(name, snapshot(name, row.found, row.readTime));
            }
            if (byName.size !== new Set(documents).size) throw Error('incomplete_inbox_batch');
            return documents.map(name => byName.get(name));
          },
          async get(ref) {
            if (ref.path) return (await tx.getAll(ref))[0];
            const {parent, query} = ref;
            const rows = await post(parent + ':runQuery', {structuredQuery: query, transaction});
            return {docs: rows.filter(row => row.document).map(row =>
              snapshot(row.document.name, row.document, row.readTime))};
          },
      };
      let committed = false;
      try {
        const value = await read(tx);
        if (writes.length) {
          await post(DOCUMENTS + ':commit', {transaction, writes});
          committed = true;
        }
        return value;
      } finally {
        if (!committed) {
          try {
            await post(DOCUMENTS + ':rollback', {transaction});
          } catch {
            // The Firestore transaction expires if cleanup is unavailable.
          }
        }
      }
    },
  };
}
