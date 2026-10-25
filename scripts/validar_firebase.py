#!/usr/bin/env python3
"""Verifica apenas a configuração local; não acessa o Firebase nem revela a API key."""
from pathlib import Path
import json
import re
import sys

root = Path(__file__).resolve().parent.parent
config_path = root / 'app' / 'google-services.json'
if not config_path.is_file():
    print('ERRO: arquivo app/google-services.json não encontrado')
    sys.exit(1)

try:
    data = json.loads(config_path.read_text(encoding='utf-8'))
    project_id = data['project_info']['project_id']
    clients = data['client']
    gradle = (root / 'app' / 'build.gradle.kts').read_text(encoding='utf-8')
    match = re.search(r'applicationId\s*=\s*"([^"]+)"', gradle)
    package = match.group(1) if match else None
    if not package:
        raise ValueError('applicationId ausente em app/build.gradle.kts')
    supported = [c['client_info']['android_client_info']['package_name'] for c in clients]
    if package not in supported:
        raise ValueError('O pacote Android não corresponde ao do Firebase')
    client = next(c for c in clients if c['client_info']['android_client_info']['package_name'] == package)
    if not client.get('api_key') or not client['api_key'][0].get('current_key'):
        raise ValueError('A configuração Firebase está incompleta')
    if not client['client_info'].get('mobilesdk_app_id'):
        raise ValueError('App ID do Firebase está ausente')
    manifest = (root / 'app' / 'src' / 'main' / 'AndroidManifest.xml').read_text(encoding='utf-8')
    if 'android.permission.INTERNET' not in manifest:
        raise ValueError('Permissão INTERNET ausente')
except (KeyError, IndexError, TypeError, ValueError, json.JSONDecodeError) as exc:
    print(f'ERRO: {exc}')
    sys.exit(1)

print('OK: Configuração Firebase válida (verificação local)')
print(f'Projeto: {project_id}')
print(f'Pacote Android: {package}')
print('ATENÇÃO: ative Authentication (E-mail/Senha), Firestore e publique firestore.rules no console.')
