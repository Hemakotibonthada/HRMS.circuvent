// X/Twitter reads `twitter:image` in preference to `og:image`, so the route has
// to exist even though the artwork is identical. Without it the card falls back
// to `summary` and renders a thumbnail instead of the full-width image.
export { default, alt, size, contentType } from "./opengraph-image";
