// Allow TypeScript to import CSS files (handled by webpack css-loader)
declare module '*.css';

// Allow TypeScript to import PNG/SVG/image assets
declare module '*.png';
declare module '*.svg';

// Injected by webpack DefinePlugin — set API_BASE env var at build time
// Dev default: http://localhost:3000   Prod: https://app.lessmissed.com
declare const __API_BASE__: string;
