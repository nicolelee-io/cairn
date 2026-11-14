/** A stored photo's file: the ~400px thumb, the ~2048px display copy, or the untouched original. */
export const photoUrl = (id: string, kind: 'thumb' | 'display' | 'original') =>
  `/api/photos/${id}/${kind}`
