import { getAvatarInitials } from '../../utils/avatarInitials';

describe('getAvatarInitials', () => {
    it.each([
        ['Ada Lovelace', 'AL'],
        ['Mary Jane Watson', 'MW'],
        ['Ada', 'A'],
        ['  Ada\tLovelace  ', 'AL'],
        ['👩🏽‍💻 Lovelace', '👩🏽‍💻L'],
    ])('returns first and last name-component graphemes for %s', (name, expected) => {
        expect(getAvatarInitials(name)).toBe(expected);
    });

    it.each([undefined, null, '', '   '])('uses a visible fallback for a missing name', (name) => {
        expect(getAvatarInitials(name)).toBe('??');
    });
});