package com.worktrac.backend.setupvalue;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface SetupValueRepository extends JpaRepository<SetupValue, Long> {

    List<SetupValue> findByPerson_IdAndField_Exercise_Id(Long personId, Long exerciseId);

    Optional<SetupValue> findByPerson_IdAndField_Id(Long personId, Long fieldId);
}
