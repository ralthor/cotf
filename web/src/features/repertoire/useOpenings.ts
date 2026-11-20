import { useEffect, useState } from 'react';
import { loadOpenings, type OpeningTable } from '../../core/openings/names';

/** The opening-name table, once loaded (null until then, or if it failed to load). */
export function useOpenings(): OpeningTable | null {
  const [table, setTable] = useState<OpeningTable | null>(null);
  useEffect(() => {
    let live = true;
    loadOpenings().then(
      (t) => live && setTable(t),
      () => undefined,
    );
    return () => {
      live = false;
    };
  }, []);
  return table;
}
