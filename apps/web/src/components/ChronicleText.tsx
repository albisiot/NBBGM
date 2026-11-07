// Testo di una riga della cronaca con le sigle delle squadre che portano alla loro pagina e l'etichetta del tipo.
import { Link } from 'react-router';
import { splitTeams, TYPE_LABEL } from '../lib/chronicle.ts';
import { Tag, type TagTone } from './ui.tsx';

/** Testo di una riga con le sigle delle squadre che portano alla loro pagina. */
export function ChronicleText({
  leagueId,
  text,
  codes,
}: {
  leagueId: string;
  text: string;
  codes: string[];
}) {
  return (
    <span>
      {splitTeams(text, codes).map((part, i) =>
        'code' in part ? (
          <Link
            key={i}
            to={`/lega/${leagueId}/squadre/${part.code}`}
            className="font-titolo font-semibold text-rosso-700 hover:underline dark:text-rosso-300"
          >
            {part.code}
          </Link>
        ) : (
          <span key={i}>{part.text}</span>
        ),
      )}
    </span>
  );
}

/** Colore dell'etichetta: scambi d'inchiostro, infortuni in rosso, il resto a filo. */
export function chronicleTone(type: string): TagTone {
  if (type === 'trade') return 'ink';
  if (type === 'injury') return 'red';
  return 'outline';
}

/** Una riga della cronaca: etichetta del tipo e testo, come le brevi del giornale. */
export function ChronicleLine({
  leagueId,
  type,
  text,
  codes,
}: {
  leagueId: string;
  type: string;
  text: string;
  codes: string[];
}) {
  return (
    <>
      <span className="mr-2 align-[0.1em]">
        <Tag tone={chronicleTone(type)}>{TYPE_LABEL[type] ?? type}</Tag>
      </span>
      <ChronicleText leagueId={leagueId} text={text} codes={codes} />
    </>
  );
}
