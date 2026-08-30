package com.worktrac.backend.quota;

import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.stereotype.Component;

// How much one household may create. Nothing capped this before, so a single account could grow the
// shared Azure SQL database without bound -- and on the Basic tier that has a hard ceiling, so one
// abusive household degrades or halts EVERY other one. Writes start failing, GlobalExceptionHandler
// answers 503, and every client then queues and retries, which amplifies the load rather than
// relieving it.
//
// Every default is set one to two orders of magnitude above real use. These are not a product
// limit anyone is meant to feel; they are the ceiling that stops a deliberate abuser, and a real
// household hitting one is a signal that the number is wrong, not that they did something wrong.
// That is exactly why QuotaService warns at 80% as well as refusing at 100%.
//
// Env-overridable per environment, like the rate limits -- local and lower raise them far out of
// the way so the e2e suite cannot trip one.
@Component
@ConfigurationProperties(prefix = "app.quota")
public class QuotaProperties {

    // A household is a family, not an organisation. Five is generous; twenty is absurd.
    private int peoplePerAccount = 20;

    // Own exercises only -- the preloaded global catalog does not count against anyone.
    private int exercisesPerAccount = 1000;

    private int tagsPerAccount = 200;

    private int routinesPerPerson = 100;

    private int customFieldsPerExercise = 20;

    // Checked ONLY on import, never on logging a set. See QuotaService.requireSetCapacity.
    private int setsPerAccount = 500_000;

    public int getPeoplePerAccount() {
        return peoplePerAccount;
    }

    public void setPeoplePerAccount(int peoplePerAccount) {
        this.peoplePerAccount = peoplePerAccount;
    }

    public int getExercisesPerAccount() {
        return exercisesPerAccount;
    }

    public void setExercisesPerAccount(int exercisesPerAccount) {
        this.exercisesPerAccount = exercisesPerAccount;
    }

    public int getTagsPerAccount() {
        return tagsPerAccount;
    }

    public void setTagsPerAccount(int tagsPerAccount) {
        this.tagsPerAccount = tagsPerAccount;
    }

    public int getRoutinesPerPerson() {
        return routinesPerPerson;
    }

    public void setRoutinesPerPerson(int routinesPerPerson) {
        this.routinesPerPerson = routinesPerPerson;
    }

    public int getCustomFieldsPerExercise() {
        return customFieldsPerExercise;
    }

    public void setCustomFieldsPerExercise(int customFieldsPerExercise) {
        this.customFieldsPerExercise = customFieldsPerExercise;
    }

    public int getSetsPerAccount() {
        return setsPerAccount;
    }

    public void setSetsPerAccount(int setsPerAccount) {
        this.setsPerAccount = setsPerAccount;
    }
}
