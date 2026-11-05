// Area gulir dan panel tab perlu tabIndex=0 agar bisa dijangkau papan ketik (WCAG 2.1.1; aturan axe
// "scrollable-region-focusable" dan pola ARIA tabs). Aturan lint jsx-a11y/no-noninteractive-tabindex tidak
// mengenal pengecualian ini untuk role="region"/"tabpanel", jadi propnya disebar dari satu tempat yang
// terdokumentasi ini, bukan ditulis di tiap JSX.
export const BISA_DIFOKUS = { tabIndex: 0 } as const;
