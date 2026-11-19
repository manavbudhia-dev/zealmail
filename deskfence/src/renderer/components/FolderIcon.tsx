import React from 'react';
import { mixHex } from '../utils/color';

/**
 * Windows-style yellow folder. Used for every folder item (Windows' own icon lookup returns a
 * drive icon for folders) and in front of compact fence titles. `tint` + `strength` recolour it,
 * keeping the two-tone look.
 */
const FolderIcon: React.FC<{ size: number; tint?: string; strength?: number }> = ({ size, tint, strength = 0 }) => {
  const back = tint && strength > 0 ? mixHex('#e9a825', mixHex(tint, '#000000', 0.15), strength) : '#e9a825';
  const front = tint && strength > 0 ? mixHex('#ffd25f', mixHex(tint, '#ffffff', 0.25), strength) : '#ffd25f';
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
      <path
        d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.2c.6 0 1.2.3 1.6.8l1.3 1.7h7.9A2.5 2.5 0 0 1 22 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z"
        fill={back}
      />
      <path d="M2 10a2.5 2.5 0 0 1 2.5-2.5h15A2.5 2.5 0 0 1 22 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z" fill={front} />
    </svg>
  );
};

export default FolderIcon;
