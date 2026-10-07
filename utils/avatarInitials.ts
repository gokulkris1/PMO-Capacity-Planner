const FALLBACK_INITIALS = '??';

const graphemeSegmenter = typeof Intl !== 'undefined' && typeof Intl.Segmenter === 'function'
    ? new Intl.Segmenter(undefined, { granularity: 'grapheme' })
    : undefined;

function firstGrapheme(value: string): string {
    const segment = graphemeSegmenter?.segment(value)[Symbol.iterator]().next().value;
    return segment?.segment ?? Array.from(value.normalize('NFC'))[0] ?? '';
}

/**
 * Builds display initials from the first and last non-empty name components.
 */
export function getAvatarInitials(name: string | null | undefined): string {
    const components = name?.trim().split(/\s+/).filter(Boolean) ?? [];

    if (components.length === 0) return FALLBACK_INITIALS;

    const first = firstGrapheme(components[0]);
    if (components.length === 1) return first.toLocaleUpperCase() || FALLBACK_INITIALS;

    const last = firstGrapheme(components[components.length - 1]);
    return `${first}${last}`.toLocaleUpperCase() || FALLBACK_INITIALS;
}