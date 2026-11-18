package com.worktrac.backend.billing.store;

import com.worktrac.backend.billing.BillingSource;
import org.springframework.stereotype.Component;

import java.util.List;
import java.util.Optional;

/** Every store provider this backend has, by source. Adding Google Play is adding one bean. */
@Component
public class StoreBillingProviders {

    private final List<StoreBillingProvider> providers;

    public StoreBillingProviders(List<StoreBillingProvider> providers) {
        this.providers = List.copyOf(providers);
    }

    // Looked up per call rather than indexed at startup, so a provider's source() is only ever asked
    // once the context is up (a test's @MockitoBean is stubbed by then).
    public Optional<StoreBillingProvider> forSource(BillingSource source) {
        if (source == null) {
            return Optional.empty();
        }
        List<StoreBillingProvider> matching = providers.stream().filter(p -> p.source() == source).toList();
        if (matching.size() > 1) {
            throw new IllegalStateException("Two store providers for " + source);
        }
        return matching.stream().findFirst();
    }
}
