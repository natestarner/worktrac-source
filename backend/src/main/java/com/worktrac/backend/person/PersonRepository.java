package com.worktrac.backend.person;

import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;
import java.util.Optional;

public interface PersonRepository extends JpaRepository<Person, Long> {

    List<Person> findByAccount_IdOrderByCreatedAtAsc(Long accountId);

    Optional<Person> findByIdAndAccount_Id(Long id, Long accountId);
}
