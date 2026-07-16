import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import ConfigureExerciseModal from './ConfigureExerciseModal';

vi.mock('../../api/exercises', () => ({
  addCustomField: vi.fn(),
  updateCustomField: vi.fn(),
  removeCustomField: vi.fn(),
  setExerciseCategory: vi.fn(),
  updateExercise: vi.fn(),
}));
vi.mock('../../api/personCategories', () => ({ createPersonCategory: vi.fn() }));

function renderModal(exercise) {
  return render(
    <ConfigureExerciseModal
      exercise={exercise}
      personId={1}
      exerciseId={exercise.id}
      currentCategoryId={null}
      categories={[]}
      customFields={[]}
      onClose={vi.fn()}
      onFieldsChanged={vi.fn()}
      onCategoryChanged={vi.fn()}
      onExerciseChanged={vi.fn()}
      onRequestDelete={vi.fn()}
    />,
  );
}

describe('ConfigureExerciseModal ownership', () => {
  it('shows "Created by you" plus rename + delete for your own exercise', () => {
    renderModal({ id: 1, name: 'My Curl', isGlobal: false, setupFields: [] });

    expect(screen.getByText('Created by you')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Save' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete this exercise' })).toBeInTheDocument();
  });

  it('shows "Preloaded exercise" and no rename/delete for a shared exercise', () => {
    renderModal({ id: 2, name: 'Barbell Bench Press', isGlobal: true, setupFields: [] });

    expect(screen.getByText('Preloaded exercise')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Save' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Delete this exercise' })).not.toBeInTheDocument();
  });
});
