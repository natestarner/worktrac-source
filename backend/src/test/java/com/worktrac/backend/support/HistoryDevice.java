package com.worktrac.backend.support;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ArrayNode;

import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TreeMap;

// A simulated device holding History a month at a time, applying sync replies exactly the way the
// app does (frontend/src/lib/historySync.js#applyHistorySync): the months afterwards are exactly the
// reply's list, each either sent or kept from what was held, and a listed month that was neither is a
// failure -- never silently dropped.
//
// Kept deliberately dumb and copyable, so a test can hold several at different staleness, snapshot
// one at any point, and later "restore" it the way a reload restores a persisted cache.
public final class HistoryDevice {

    private final ObjectMapper objectMapper;
    private Map<String, JsonNode> months = new TreeMap<>(Comparator.reverseOrder());

    public HistoryDevice(ObjectMapper objectMapper) {
        this.objectMapper = objectMapper;
    }

    // What the device sends as `have`.
    public Map<String, String> have() {
        Map<String, String> have = new LinkedHashMap<>();
        months.forEach((month, content) -> have.put(month, content.get("fp").asText()));
        return have;
    }

    public void apply(JsonNode reply) {
        // A SCOPED reply speaks only for the months in `scope`: of those, the listed ones are sent or
        // kept and the unlisted ones are gone; every month outside the scope stays exactly as held.
        JsonNode scope = reply.get("scope");
        Map<String, JsonNode> next = new TreeMap<>(Comparator.reverseOrder());
        if (scope != null && scope.isArray()) {
            next.putAll(months);
            for (JsonNode scoped : scope) {
                next.remove(scoped.asText());
            }
        }
        for (JsonNode listed : reply.get("months")) {
            String month = listed.asText();
            JsonNode sent = reply.get("changed").get(month);
            if (sent != null) {
                next.put(month, sent);
            } else if (months.containsKey(month)) {
                next.put(month, months.get(month));
            } else {
                throw new AssertionError("The sync listed " + month + " without sending it, and the device did not hold it");
            }
        }
        months = next;
    }

    // What the device shows for one month: its sessions, or an empty list if it holds no such month.
    public ArrayNode sessionsIn(String month) {
        ArrayNode sessions = objectMapper.createArrayNode();
        JsonNode held = months.get(month);
        if (held != null) held.get("sessions").forEach(sessions::add);
        return sessions;
    }

    // The start time of a held session, or null -- lets a test scope a sync to the workout
    // its write touched, the way the app looks the start time up in its own cache.
    public String startedAtOf(long sessionId) {
        for (JsonNode month : months.values()) {
            for (JsonNode session : month.get("sessions")) {
                if (session.get("id").asLong() == sessionId) return session.get("startedAt").asText();
            }
        }
        return null;
    }

    // Every session, newest month first -- what every screen reads (flattenHistory).
    public ArrayNode flatten() {
        ArrayNode all = objectMapper.createArrayNode();
        months.values().forEach(month -> month.get("sessions").forEach(all::add));
        return all;
    }

    // A device that holds nothing: a new device, or one whose cache predates the sync.
    public void forget() {
        months = new TreeMap<>(Comparator.reverseOrder());
    }

    public HistoryDevice copy() {
        HistoryDevice copy = new HistoryDevice(objectMapper);
        copy.months.putAll(months);   // JsonNodes are never mutated here, so sharing them is safe
        return copy;
    }

    public void restoreFrom(HistoryDevice snapshot) {
        months = new TreeMap<>(Comparator.reverseOrder());
        months.putAll(snapshot.months);
    }

    public int monthCount() {
        return months.size();
    }
}
