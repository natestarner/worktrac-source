package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingSource;
import com.worktrac.backend.support.MutableClock;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

// Apple's documented recovery from missed notifications (Get Notification History, failures only),
// which is also the only way a SANDBOX notification is ever retried. Every undelivered subscription
// goes through the same apply path as a live notification; this pins the sweep around it.
class StoreNotificationRecoveryTest {

    private StoreBillingProvider provider;
    private StoreBillingService service;
    private MutableClock clock;
    private StoreNotificationRecovery recovery;

    @BeforeEach
    void setUp() {
        provider = mock(StoreBillingProvider.class);
        when(provider.source()).thenReturn(BillingSource.APP_STORE);
        when(provider.isConfigured()).thenReturn(true);
        service = mock(StoreBillingService.class);
        clock = new MutableClock();
        recovery = new StoreNotificationRecovery(new StoreBillingProviders(List.of(provider)), service, clock);
    }

    private static StorePurchaseReference ref(String id, StoreEnvironment environment) {
        return new StorePurchaseReference(BillingSource.APP_STORE, id, environment, null, null);
    }

    @Test
    void looksBackFarEnoughToCoverAMissedRun() throws Exception {
        when(provider.undeliveredSince(any())).thenReturn(List.of());
        recovery.recover();
        verify(provider).undeliveredSince(eq(clock.instant().minus(StoreNotificationRecovery.LOOK_BACK)));
        assertThat(StoreNotificationRecovery.LOOK_BACK).isGreaterThan(java.time.Duration.ofHours(1));
    }

    // Several failed messages about one subscription ask one question; the store's current answer
    // covers all of them.
    @Test
    void reAppliesEachUndeliveredSubscriptionOnce() throws Exception {
        StorePurchaseReference a = ref("1000", StoreEnvironment.SANDBOX);
        StorePurchaseReference b = ref("2000", StoreEnvironment.PRODUCTION);
        when(provider.undeliveredSince(any())).thenReturn(List.of(a, b, ref("1000", StoreEnvironment.SANDBOX)));

        assertThat(recovery.recover(provider)).isEqualTo(2);

        verify(service).apply(provider, a, "recovery");
        verify(service).apply(provider, b, "recovery");
        verify(service, times(2)).apply(any(), any(), eq("recovery"));
    }

    @Test
    void oneSubscriptionFailingDoesNotStopTheRest() throws Exception {
        StorePurchaseReference broken = ref("1000", StoreEnvironment.PRODUCTION);
        StorePurchaseReference fine = ref("2000", StoreEnvironment.PRODUCTION);
        when(provider.undeliveredSince(any())).thenReturn(List.of(broken, fine));
        doThrow(new StoreBillingException("down")).when(service).apply(provider, broken, "recovery");

        assertThat(recovery.recover(provider)).isEqualTo(1);
        verify(service).apply(provider, fine, "recovery");
    }

    @Test
    void theStoreBeingUnreachableWaitsForTheNextRun() throws Exception {
        when(provider.undeliveredSince(any())).thenThrow(new StoreBillingException("down"));
        assertThat(recovery.recover(provider)).isZero();
        verify(service, never()).apply(any(), any(), any());
    }

    @Test
    void anUnconfiguredStoreIsNotAsked() throws Exception {
        when(provider.isConfigured()).thenReturn(false);
        recovery.recover();
        verify(provider, never()).undeliveredSince(any());
    }
}
