package br.com.atriocatolico

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class OtaStoragePolicyTest {
    private val reserve = 16L * 1024L * 1024L

    @Test fun acceptsAvailableSpaceForApkAndReserve() {
        val apk = 25_000_000L
        assertTrue(OtaStoragePolicy.canStageApk(apk + reserve, apk))
        assertTrue(OtaStoragePolicy.canStageApk(apk + reserve + 1L, apk))
    }

    @Test fun rejectsSpaceBelowReserveAndNegativeSpace() {
        val apk = 25_000_000L
        assertFalse(OtaStoragePolicy.canStageApk(apk + reserve - 1L, apk))
        assertFalse(OtaStoragePolicy.canStageApk(apk, apk))
        assertFalse(OtaStoragePolicy.canStageApk(-1L, apk))
        assertFalse(OtaStoragePolicy.canStageApk(0L, apk))
    }

    @Test fun rejectsInvalidApkSizeWithoutArithmeticOverflow() {
        assertFalse(OtaStoragePolicy.canStageApk(Long.MAX_VALUE, 0L))
        assertFalse(OtaStoragePolicy.canStageApk(Long.MAX_VALUE, -1L))
        assertFalse(OtaStoragePolicy.canStageApk(Long.MAX_VALUE, Long.MAX_VALUE))
        assertFalse(OtaStoragePolicy.canStageApk(
            Long.MAX_VALUE, OtaApkPolicy.MAX_APK_BYTES + 1L))
        assertTrue(OtaStoragePolicy.canStageApk(
            OtaApkPolicy.MAX_APK_BYTES + reserve, OtaApkPolicy.MAX_APK_BYTES))
    }
}
