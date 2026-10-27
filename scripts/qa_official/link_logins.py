"""Run ONCE with operator ADC, outside CI. Never creates or promotes users."""
import argparse
import json
from pathlib import Path
import sys
from common import PROJECT, UIDS, accounts, require


def link(auth, bots, apply=False):
    # Check all accounts BEFORE modifying any of them. Stop on an occupied email
    # or an existing different email instead of overwriting another identity.
    for alias, entry in bots.items():
        user = auth.get_user(UIDS[alias])
        require(not user.disabled, "disabled_bot")
        require(user.uid == UIDS[alias], "uid_mismatch")
        require(not user.email or user.email.lower() == entry['email'].lower(), "existing_email_differs")
        try:
            owner = auth.get_user_by_email(entry['email'])
            require(owner.uid == user.uid, "email_owned_by_other_user")
        except auth.UserNotFoundError:
            pass
    if apply:
        for alias, entry in bots.items():
            auth.update_user(UIDS[alias], email=entry['email'], password=entry['password'])
            print("Login vinculado ao UID " + UIDS[alias])


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('file', help='JSON privado com os tres emails e senhas')
    parser.add_argument('--apply', action='store_true', help='Vincular email/senha mantendo os UIDs')
    args = parser.parse_args()
    bots = accounts(Path(args.file).read_text())
    import firebase_admin
    from firebase_admin import auth
    firebase_admin.initialize_app(options={'projectId': PROJECT})
    link(auth, bots, args.apply)
    print('Vinculacao concluida.' if args.apply else 'Verificacao concluida sem alterar contas.')


if __name__ == '__main__':
    try:
        main()
    except Exception:
        # Admin SDK failures may echo email addresses. Never print raw errors.
        print('Falha: confira ADC, permissao Firebase Auth e os tres UIDs/emails. Nenhuma conta nova foi criada.')
        sys.exit(1)
