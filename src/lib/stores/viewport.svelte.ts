// Which layout tier is on screen. Tailwind's `md:` / `lg:` variants cover most
// of the responsive work; this is for the handful of decisions JS has to make
// (row layout, map height, whether the rail or the detail pane is showing).
//
// Breakpoints match Tailwind's: phone < 768 ≤ tablet < 1024 ≤ desktop.
export type Tier = "phone" | "tablet" | "desktop";

function read(): Tier {
	if (typeof window === "undefined") return "desktop";
	if (window.matchMedia("(min-width: 1024px)").matches) return "desktop";
	if (window.matchMedia("(min-width: 768px)").matches) return "tablet";
	return "phone";
}

let tier = $state<Tier>(read());

if (typeof window !== "undefined") {
	const sync = () => {
		const next = read();
		if (next !== tier) tier = next;
	};
	for (const q of ["(min-width: 768px)", "(min-width: 1024px)"]) {
		const mql = window.matchMedia(q);
		mql.addEventListener("change", sync);
	}
	window.addEventListener("resize", sync);
}

export const viewport = {
	get tier() {
		return tier;
	},
	get isPhone() {
		return tier === "phone";
	},
	get isTablet() {
		return tier === "tablet";
	},
	get isDesktop() {
		return tier === "desktop";
	},
	/** Phone or tablet: no room for the evidence gutter beside each tag. */
	get narrow() {
		return tier !== "desktop";
	},
};
