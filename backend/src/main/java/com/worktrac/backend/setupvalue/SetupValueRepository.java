package com.worktrac.backend.setupvalue;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SetupValueRepository extends JpaRepository<SetupValue, Long> {

    List<SetupValue> findByPerson_IdAndField_Exercise_Id(Long personId, Long exerciseId);

    Optional<SetupValue> findByPerson_IdAndField_Id(Long personId, Long fieldId);

    // Used when forking a system exercise: finds this account's setup values for one
    // of the original exercise's fields, so they can be re-pointed to (or dropped
    // alongside) the corresponding field on the account-owned fork.
    List<SetupValue> findByField_IdAndPerson_IdIn(Long fieldId, List<Long> personIds);
}
