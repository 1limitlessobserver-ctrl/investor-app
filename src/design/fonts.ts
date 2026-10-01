// Self-hosted fonts: Vite bundles each package's woff2 files, so no font is fetched from a third
// party (CSP font-src 'self'). The families they register are the ones tokens.css names:
// 'Instrument Serif', 'Inter Tight Variable' and 'JetBrains Mono Variable'.
import '@fontsource/instrument-serif';
import '@fontsource-variable/inter-tight';
import '@fontsource-variable/jetbrains-mono';
