package com.google.firebase.messaging;

import android.content.Intent;
import android.os.IBinder;
import com.google.android.gms.tasks.Task;

/** Usa o binder de entrega local do SDK apenas no APK de instrumentação. */
public final class QaMessagingInjection {
    private QaMessagingInjection() {}

    public static Task<Void> deliver(IBinder binder, Intent intent) {
        WithinAppServiceConnection.BindRequest request =
                new WithinAppServiceConnection.BindRequest(intent);
        ((WithinAppServiceBinder) binder).send(request);
        return request.getTask();
    }
}
