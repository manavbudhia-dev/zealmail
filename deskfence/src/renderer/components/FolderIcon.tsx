import React from 'react';

/**
 * Windows-style yellow folder. Used for every folder item (Windows' own icon lookup returns a
 * drive icon for folders) and in front of compact fence titles.
 */
const FolderIcon: React.FC<{ size: number }> = ({ size }) => (
  <svg width={size} height={size} viewBox="0 0 24 24" aria-hidden="true" style={{ flexShrink: 0 }}>
    <path
      d="M2 6.5A2.5 2.5 0 0 1 4.5 4h4.2c.6 0 1.2.3 1.6.8l1.3 1.7h7.9A2.5 2.5 0 0 1 22 9v8.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z"
      fill="#e9a825"
    />
    <path d="M2 10a2.5 2.5 0 0 1 2.5-2.5h15A2.5 2.5 0 0 1 22 10v7.5a2.5 2.5 0 0 1-2.5 2.5h-15A2.5 2.5 0 0 1 2 17.5z" fill="#ffd25f" />
  </svg>
);

export default FolderIcon;
