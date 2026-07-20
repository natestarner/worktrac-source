package com.worktrac.backend.person;

import com.worktrac.backend.account.Account;
import com.worktrac.backend.account.AccountRepository;
import com.worktrac.backend.common.ConflictException;
import com.worktrac.backend.common.NotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

@Service
public class PersonService {

    private final PersonRepository personRepository;
    private final AccountRepository accountRepository;

    public PersonService(PersonRepository personRepository, AccountRepository accountRepository) {
        this.personRepository = personRepository;
        this.accountRepository = accountRepository;
    }

    // The account-scoping guard every other service that takes a personId path variable
    // calls first. Throws 404 (not 403) on a personId that belongs to another account,
    // so callers can never distinguish "doesn't exist" from "not yours."
    @Transactional(readOnly = true)
    public Person requireOwnedPerson(Long personId, Long accountId) {
        return personRepository.findByIdAndAccount_Id(personId, accountId)
                .orElseThrow(() -> new NotFoundException("No such person"));
    }

    @Transactional(readOnly = true)
    public List<PersonDto> list(Long accountId) {
        return personRepository.findByAccount_IdOrderByCreatedAtAsc(accountId).stream()
                .map(PersonDto::from)
                .toList();
    }

    @Transactional
    public PersonDto add(Long accountId, String name) {
        Account account = accountRepository.getReferenceById(accountId);
        Person person = personRepository.save(new Person(account, name.trim(), false));
        return PersonDto.from(person);
    }

    @Transactional
    public PersonDto rename(Long accountId, Long personId, String name) {
        Person person = requireOwnedPerson(personId, accountId);
        person.setName(name.trim());
        return PersonDto.from(person);
    }

    @Transactional
    public PersonDto setRestTimerEnabled(Long accountId, Long personId, boolean enabled) {
        Person person = requireOwnedPerson(personId, accountId);
        person.setRestTimerEnabled(enabled);
        return PersonDto.from(person);
    }

    @Transactional
    public void remove(Long accountId, Long personId) {
        Person person = requireOwnedPerson(personId, accountId);
        if (person.isPrimary()) {
            throw new ConflictException("Cannot remove the primary person on an account");
        }
        personRepository.delete(person);
    }
}
