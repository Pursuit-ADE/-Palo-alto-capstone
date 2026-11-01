// The sales regions in the data. No imports, so client code (the Read as line) can use the list without pulling the
// database schema into the browser bundle, as importing it from scope.ts did (review of #102, Nov 1).
export const ALL_REGIONS = ['central', 'east', 'west'];
