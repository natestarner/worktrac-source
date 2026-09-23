import { describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import Select from './Select';

const OPTIONS = [
  { value: 'recent', label: 'Most recent' },
  { value: 'name', label: 'Name A–Z' },
];

function renderSelect(props = {}) {
  const onChange = vi.fn();
  const utils = render(<Select id="s" label="Sort" value="name" onChange={onChange} options={OPTIONS} {...props} />);
  return { onChange, ...utils };
}

describe('Select', () => {
  it('labels the native control and reports the picked value', () => {
    const { onChange } = renderSelect();
    const select = screen.getByLabelText('Sort');
    expect(select.tagName).toBe('SELECT');
    fireEvent.change(select, { target: { value: 'recent' } });
    expect(onChange).toHaveBeenCalledWith('recent');
  });

  it('draws the selected option label over the native control', () => {
    const { container } = renderSelect();
    expect(container.querySelector('.select-value-text')).toHaveTextContent('Name A–Z');
  });

  // A persisted value from before an option was renamed or removed must not draw an empty field --
  // the native control shows its first option in that case, so the drawing has to agree with it.
  it('draws the first option for a value that names none', () => {
    const { container } = renderSelect({ value: 'est1rm' });
    expect(container.querySelector('.select-value-text')).toHaveTextContent('Most recent');
  });

  // The sizers are pseudo-element text: a real text node per option would collide with every
  // getByText for an option label on the same screen.
  it('adds no text node per option beyond the native <option>s', () => {
    renderSelect();
    expect(screen.getAllByText('Most recent')).toHaveLength(1);
  });

  it('reserves width for sizeToLabels instead of the current options when given', () => {
    const { container } = renderSelect({ sizeToLabels: ['Best set volume', 'Most recent'] });
    const sizers = [...container.querySelectorAll('.select-value-sizer')].map((el) => el.dataset.label);
    expect(sizers).toEqual(['Best set volume', 'Most recent']);
  });

  it('hangs a trailing control in the caption, outside the field the <select> covers', () => {
    const { container } = renderSelect({ children: <button type="button">Help</button> });
    const help = screen.getByRole('button', { name: 'Help' });
    expect(container.querySelector('.select-caption')).toContainElement(help);
    expect(container.querySelector('.select-field')).not.toContainElement(help);
  });
});
