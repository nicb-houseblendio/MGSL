/**
 * Comments on a split job.
 *
 * Straight from the client prototype's note modal: a running history of short
 * entries, plus an optional "email the trader" toggle. It exists because the
 * warehouse and the trader are the two halves of a split and neither sees the
 * other's screen. When a bundle comes up short, or the wood is not what the tally
 * said, the warehouse needs somewhere to say so against THAT order.
 *
 * ⚠️ Notes live in React state only. Nothing is persisted and no email is sent —
 * the toggle records intent so the flow can be reviewed end to end. Where these
 * should live in NetSuite (transaction note, custom record, user note) has never
 * been discussed with the client.
 */

import * as React from 'react';
import { Dialog, DialogContent } from '@/components/ui/dialog';
import { ARCH_SURFACE } from '@/components/arch/archColors';
import type { ArchSplitJob, ArchSplitNote } from '@/types/archSplit';

interface SplitNoteDialogProps {
  job: ArchSplitJob;
  notes: ArchSplitNote[];
  onAdd: (text: string, emailTrader: boolean) => void;
  onClose: () => void;
}

/** first.last@mgsl.com, the convention the prototype assumes. */
const traderEmail = (trader: string): string =>
  `${(trader || 'trader').toLowerCase().replace(/\s+/g, '.')}@mgsl.com`;

export const SplitNoteDialog = ({ job, notes, onAdd, onClose }: SplitNoteDialogProps) => {
  const [draft, setDraft] = React.useState('');
  const [emailTrader, setEmailTrader] = React.useState(true);
  const empty = draft.trim() === '';

  const submit = () => {
    if (empty) return;
    onAdd(draft.trim(), emailTrader);
    setDraft('');
  };

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent
        className="max-w-[560px] w-[94vw] p-0 gap-0 overflow-hidden"
        style={{ display: 'flex', flexDirection: 'column', maxHeight: '86vh' }}
        aria-describedby={undefined}
        aria-label={`Comments on ${job.soNo}`}
      >
        <div style={{ padding: '14px 20px', background: 'linear-gradient(135deg,#0F2641,#1A3D63)' }}>
          <div style={{ color: '#fff', fontSize: 15, fontWeight: 700 }}>Comments</div>
          <div style={{ color: '#AFC2D6', fontSize: 12, marginTop: 2 }}>
            <span className="font-mono">{job.soNo}</span> · {job.customer} · {job.trader}
          </div>
        </div>

        <div style={{ padding: '16px 20px', overflowY: 'auto', background: '#fff' }}>
          {notes.length === 0 ? (
            <div style={{ fontSize: 12.5, color: ARCH_SURFACE.textLight, padding: '10px 0 16px' }}>
              Aucun commentaire pour l'instant.
            </div>
          ) : (
            <div style={{ marginBottom: 16 }}>
              {notes.map((n, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    gap: 10,
                    padding: '9px 0',
                    borderBottom: i === notes.length - 1 ? 'none' : '1px solid #EEF1F6',
                  }}
                >
                  <span
                    className="font-mono"
                    style={{ fontSize: 10.5, color: ARCH_SURFACE.textLight, minWidth: 46, paddingTop: 1 }}
                  >
                    {n.date}
                  </span>
                  <span style={{ fontSize: 12.5, color: ARCH_SURFACE.text, flex: 1 }}>{n.text}</span>
                  {n.emailed && (
                    <span
                      title={`Envoyé à ${traderEmail(job.trader)}`}
                      style={{ fontSize: 10, color: '#15803D', fontWeight: 700, whiteSpace: 'nowrap' }}
                    >
                      ✉ envoyé
                    </span>
                  )}
                </div>
              ))}
            </div>
          )}

          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="Ex. bundle 2 arrive court, il manque environ 40 BF"
            rows={3}
            style={{
              width: '100%',
              padding: '9px 11px',
              borderRadius: 9,
              border: '1.5px solid #CBD5E1',
              fontSize: 12.5,
              fontFamily: 'inherit',
              resize: 'vertical',
              color: ARCH_SURFACE.text,
              background: '#fff',
            }}
          />

          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 8,
              marginTop: 10,
              fontSize: 12,
              color: ARCH_SURFACE.textMid,
              cursor: 'pointer',
            }}
          >
            <input
              type="checkbox"
              checked={emailTrader}
              onChange={(e) => setEmailTrader(e.target.checked)}
            />
            Envoyer à {job.trader} <span className="font-mono" style={{ fontSize: 11 }}>({traderEmail(job.trader)})</span>
          </label>
        </div>

        <div
          style={{
            padding: '11px 20px',
            borderTop: '1px solid #E2E8F0',
            background: '#F8FAFC',
            display: 'flex',
            gap: 10,
            justifyContent: 'flex-end',
          }}
        >
          <button
            type="button"
            onClick={onClose}
            style={{
              padding: '8px 16px',
              borderRadius: 9,
              border: '1.5px solid #CBD5E1',
              background: '#fff',
              color: ARCH_SURFACE.textMid,
              fontSize: 12.5,
              fontWeight: 600,
              cursor: 'pointer',
            }}
          >
            Fermer
          </button>
          <button
            type="button"
            onClick={submit}
            disabled={empty}
            style={{
              padding: '8px 18px',
              borderRadius: 9,
              border: 'none',
              fontSize: 12.5,
              fontWeight: 700,
              cursor: empty ? 'not-allowed' : 'pointer',
              background: empty ? '#E2E8F0' : 'linear-gradient(135deg,#1E6B47,#2A9060)',
              color: empty ? '#A6B4C2' : '#fff',
            }}
          >
            Ajouter
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
