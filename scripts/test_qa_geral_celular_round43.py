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


    def test_https_rejects_arbitrary_exported_receivers_services_and_providers(self):
        additions = (
            '<receiver android:name="br.com.atriocatolico.DebugInjectedReceiver" android:exported="true" />',
            '<receiver android:name="br.com.atriocatolico.UnexpectedReceiver" android:exported="true" />',
            '<receiver android:name="br.com.atriocatolico.UnexpectedReceiver" android:exported="true" '
            'android:permission="com.google.android.c2dm.permission.SEND">'
            '<intent-filter><action android:name="com.google.android.c2dm.intent.RECEIVE" /></intent-filter>'
            '</receiver>',
            '<service android:name="br.com.atriocatolico.ForeignService" android:exported="true" />',
            '<service android:name="com.google.firebase.messaging.FirebaseMessagingService" '
            'android:exported="true" />',
            '<provider android:name="br.com.atriocatolico.UnexpectedProvider" android:exported="true" />',
            '<receiver android:name="br.com.atriocatolico.QaConversationSignalReceiver" '
            'android:exported="false" />',
            '<service android:name="br.com.atriocatolico.LabPushService" android:exported="false" />',
            '<provider android:name="androidx.core.content.FileProvider" android:exported="false" />',
        )
        for component in additions:
            with self.subTest(component=component), self.assertRaises(PreflightError):
                verify_notice_manifest(HTTPS_MANIFEST.replace(
                    '</application>', component + '</application>'
                ), https=True)

    def test_https_rejects_sensitive_unexpected_permissions(self):
        unexpected = (
            "android.permission.READ_SMS",
            "android.permission.RECEIVE_SMS",
            "android.permission.SEND_SMS",
            "android.permission.READ_CONTACTS",
            "android.permission.READ_CALL_LOG",
            "android.permission.CAMERA",
            "android.permission.RECORD_AUDIO",
            "android.permission.ACCESS_FINE_LOCATION",
            "android.permission.QUERY_ALL_PACKAGES",
            "android.permission.REQUEST_INSTALL_PACKAGES",
            "android.permission.FOREGROUND_SERVICE_CAMERA",
            "com.vendor.arbitrary.PRIVILEGED",
        )
        for permission in unexpected:
            with self.subTest(permission=permission), self.assertRaises(PreflightError):
                verify_notice_manifest(HTTPS_MANIFEST.replace(
                    '<application',
                    '<uses-permission android:name="' + permission + '" /><application',
                ), https=True)

    def test_https_preserves_firebase_and_androidx_protected_components(self):
        sdk = '''
        <service android:name="com.google.firebase.components.ComponentDiscoveryService"
            android:exported="false" />
        <service android:name="com.google.firebase.messaging.FirebaseMessagingService"
            android:exported="false" />
        <service android:name="androidx.work.impl.background.systemjob.SystemJobService"
            android:exported="true" android:permission="android.permission.BIND_JOB_SERVICE" />
        <receiver android:name="androidx.work.impl.diagnostics.DiagnosticsReceiver"
            android:exported="true" android:permission="android.permission.DUMP">
            <intent-filter><action android:name="androidx.work.diagnostics.REQUEST_DIAGNOSTICS" /></intent-filter>
        </receiver>
        <receiver android:name="androidx.profileinstaller.ProfileInstallReceiver"
            android:exported="true" android:permission="android.permission.DUMP">
            <intent-filter><action android:name="androidx.profileinstaller.action.INSTALL_PROFILE" /></intent-filter>
        </receiver>
        '''
        manifest = HTTPS_MANIFEST.replace('</application>', sdk + '</application>')
        for permission in (
            "android.permission.INTERNET",
            "android.permission.ACCESS_NETWORK_STATE",
            "android.permission.WAKE_LOCK",
            "android.permission.RECEIVE_BOOT_COMPLETED",
            "android.permission.FOREGROUND_SERVICE",
            "com.google.android.c2dm.permission.RECEIVE",
            "com.google.android.providers.gsf.permission.READ_GSERVICES",
        ):
            manifest = manifest.replace(
                '<application', '<uses-permission android:name="' + permission + '" /><application'
            )
        verify_notice_manifest(manifest, https=True)

    def test_https_rejects_exported_contract_bypass(self):
        cases = (
            ('com.google.android.c2dm.permission.SEND', 'android.permission.DUMP'),
            ('androidx.work.impl.diagnostics.DiagnosticsReceiver',
             'br.com.atriocatolico.DiagnosticsReceiver'),
            ('android.permission.BIND_JOB_SERVICE', 'android.permission.INTERNET'),
            ('androidx.work.diagnostics.REQUEST_DIAGNOSTICS', 'arbitrary.action.INJECT'),
        )
        base = HTTPS_MANIFEST.replace(
            '</application>',
            '''<service android:name="androidx.work.impl.background.systemjob.SystemJobService"
                android:exported="true" android:permission="android.permission.BIND_JOB_SERVICE" />
               <receiver android:name="androidx.work.impl.diagnostics.DiagnosticsReceiver"
                android:exported="true" android:permission="android.permission.DUMP">
                <intent-filter><action android:name="androidx.work.diagnostics.REQUEST_DIAGNOSTICS" /></intent-filter>
               </receiver></application>''',
        )
        verify_notice_manifest(base, https=True)
        for old, new in cases:
            with self.subTest(new=new), self.assertRaises(PreflightError):
                verify_notice_manifest(base.replace(old, new), https=True)
        injection = '''<intent-filter><action android:name="arbitrary.action.INJECT" /></intent-filter>'''
        fcm = base.replace(
            '</receiver>', injection + '</receiver>', 1,
        )
        with self.assertRaises(PreflightError):
            verify_notice_manifest(fcm, https=True)


if __name__ == "__main__":
    unittest.main()
