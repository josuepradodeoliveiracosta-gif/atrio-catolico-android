"""Casos de manifesto para a assinatura descartável do laboratório de avisos."""

import unittest

from scripts.ota_apk_preflight import PreflightError
from scripts.qa_geral_celular_round43 import verify_notice_manifest

LAB_MANIFEST = """\
<manifest xmlns:android="http://schemas.android.com/apk/res/android">
    <uses-permission android:name="android.permission.POST_NOTIFICATIONS" />
    <application android:allowBackup="false">
        <meta-data android:name="firebase_messaging_auto_init_enabled" android:value="false" />
        <service android:name="br.com.atriocatolico.AtrioPushService" android:exported="false">
            <intent-filter><action android:name="com.google.firebase.MESSAGING_EVENT" /></intent-filter>
        </service>
    </application>
</manifest>
"""

HTTPS_MANIFEST = LAB_MANIFEST.replace(
    'android:allowBackup="false"', 'android:allowBackup="false" android:usesCleartextTraffic="false"'
).replace(
    '</application>',
    '''<receiver android:name="com.google.firebase.iid.FirebaseInstanceIdReceiver"
        android:exported="true" android:permission="com.google.android.c2dm.permission.SEND">
        <intent-filter><action android:name="com.google.android.c2dm.intent.RECEIVE" /></intent-filter>
    </receiver></application>''',
)


class NoticeManifestTest(unittest.TestCase):
    def test_accepts_the_private_service_and_manual_lab_entry(self):
        verify_notice_manifest(LAB_MANIFEST)

    def test_refuses_drift_in_the_notice_contract(self):
        cases = (
            ('android:allowBackup="false"', 'android:allowBackup="true"'),
            ('android:exported="false"', 'android:exported="true"'),
            ('android:value="false"', 'android:value="true"'),
            ('android.permission.POST_NOTIFICATIONS', 'android.permission.REQUEST_INSTALL_PACKAGES'),
            ('com.google.firebase.MESSAGING_EVENT', 'evento.divergente'),
            ('</application>', '<receiver android:name=".QaConversationSignalReceiver" /></application>'),
            ('</application>', '<receiver android:name=".FirebaseInstanceIdReceiver" /></application>'),
        )
        for original, changed in cases:
            with self.subTest(changed=changed), self.assertRaises(PreflightError):
                verify_notice_manifest(LAB_MANIFEST.replace(original, changed))

    def test_https_requires_the_protected_sdk_entry_and_keeps_lab_closed(self):
        verify_notice_manifest(HTTPS_MANIFEST, https=True)
        with self.assertRaises(PreflightError):
            verify_notice_manifest(HTTPS_MANIFEST)
        with self.assertRaises(PreflightError):
            verify_notice_manifest(LAB_MANIFEST.replace(
                'android:allowBackup="false"',
                'android:allowBackup="false" android:usesCleartextTraffic="false"',
            ), https=True)

    def test_https_rejects_unprotected_entry_and_lab_network(self):
        cases = (
            ('android:permission="com.google.android.c2dm.permission.SEND"', ''),
            ('android:exported="true"', 'android:exported="false"'),
            ('com.google.android.c2dm.intent.RECEIVE', 'evento.divergente'),
            ('android:usesCleartextTraffic="false"', 'android:usesCleartextTraffic="true"'),
            ('android:usesCleartextTraffic="false"',
             'android:usesCleartextTraffic="false" android:networkSecurityConfig="@xml/loopback"'),
            ('</application>', '<receiver android:name=".QaConversationSignalReceiver" /></application>'),
            ('</application>', '<provider android:name="androidx.core.content.FileProvider" /></application>'),
        )
        for original, changed in cases:
            with self.subTest(changed=changed), self.assertRaises(PreflightError):
                verify_notice_manifest(HTTPS_MANIFEST.replace(original, changed), https=True)


if __name__ == "__main__":
    unittest.main()
