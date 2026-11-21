/** Identifies an attachment across draft autosave, which turns a picked file into a stored one. */
export function trackedFileKey(name: string, size: number): string {
	return `${name}:${size}`;
}
