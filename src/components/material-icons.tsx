import { forwardRef, type SVGProps } from "react";

// A handful of filled, Material-style glyphs for the Workspace chrome (top bar, compose,
// labels). Paths are from Google's Material Icons (Apache License 2.0).
type MaterialIconProps = Omit<SVGProps<SVGSVGElement>, "ref"> & { size?: number | string };

function createMaterialIcon(path: string, displayName: string) {
	const Icon = forwardRef<SVGSVGElement, MaterialIconProps>(({ size = 24, ...props }, ref) => (
		<svg ref={ref} width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" focusable="false" {...props}>
			<path d={path} />
		</svg>
	));
	Icon.displayName = displayName;
	return Icon;
}

export const MaterialMenu = createMaterialIcon("M3 18h18v-2H3v2zm0-5h18v-2H3v2zm0-7v2h18V6H3z", "MaterialMenu");
export const MaterialApps = createMaterialIcon(
	"M4 8h4V4H4v4zm6 12h4v-4h-4v4zm-6 0h4v-4H4v4zm0-6h4v-4H4v4zm6 0h4v-4h-4v4zm6-10v4h4V4h-4zm-6 4h4V4h-4v4zm6 6h4v-4h-4v4zm0 6h4v-4h-4v4z",
	"MaterialApps",
);
export const MaterialEdit = createMaterialIcon(
	"M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04c.39-.39.39-1.02 0-1.41l-2.34-2.34c-.39-.39-1.02-.39-1.41 0l-1.83 1.83 3.75 3.75 1.83-1.83z",
	"MaterialEdit",
);
export const MaterialLabel = createMaterialIcon(
	"M17.63 5.84C17.27 5.33 16.67 5 16 5L5 5.01C3.9 5.01 3 5.9 3 7v10c0 1.1.9 1.99 2 1.99L16 19c.67 0 1.27-.33 1.63-.84L22 12l-4.37-6.16z",
	"MaterialLabel",
);
export const MaterialHelp = createMaterialIcon(
	"M11 18h2v-2h-2v2zm1-16C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.41 0-8-3.59-8-8s3.59-8 8-8 8 3.59 8 8-3.59 8-8 8zm0-14c-2.21 0-4 1.79-4 4h2c0-1.1.9-2 2-2s2 .9 2 2c0 2-3 1.75-3 5h2c0-2.25 3-2.5 3-5 0-2.21-1.79-4-4-4z",
	"MaterialHelp",
);
export const MaterialMoreVert = createMaterialIcon(
	"M12 8c1.1 0 2-.9 2-2s-.9-2-2-2-2 .9-2 2 .9 2 2 2zm0 2c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2zm0 6c-1.1 0-2 .9-2 2s.9 2 2 2 2-.9 2-2-.9-2-2-2z",
	"MaterialMoreVert",
);
export const MaterialRefresh = createMaterialIcon(
	"M17.65 6.35C16.2 4.9 14.21 4 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35z",
	"MaterialRefresh",
);
export const MaterialArrowDropDown = createMaterialIcon("M7 10l5 5 5-5z", "MaterialArrowDropDown");
export const MaterialCloud = createMaterialIcon(
	"M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM19 18H6c-2.21 0-4-1.79-4-4 0-2.05 1.53-3.76 3.56-3.97l1.07-.11.5-.95C8.08 7.14 9.94 6 12 6c2.62 0 4.88 1.86 5.39 4.43l.3 1.5 1.53.11c1.56.1 2.78 1.41 2.78 2.96 0 1.65-1.35 3-3 3z",
	"MaterialCloud",
);
export const MaterialChevronRight = createMaterialIcon("M10 6L8.59 7.41 13.17 12l-4.58 4.59L10 18l6-6z", "MaterialChevronRight");
