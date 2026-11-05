import { cloneElement, isValidElement, useId, type ReactElement, type ReactNode } from 'react';
import { cn } from '@/lib/utils';
import styles from './Field.module.css';

export interface FieldProps {
  label: string;
  bantuan?: ReactNode;
  galat?: ReactNode;
  wajib?: boolean;
  className?: string;
  /** Satu elemen input/select/textarea (id dan aria-* dipasang otomatis), atau fungsi yang menerima props-nya. */
  children:
    | ReactElement<Record<string, unknown>>
    | ((props: { id: string; 'aria-describedby'?: string; 'aria-invalid'?: true; 'aria-required'?: true }) => ReactNode);
}

// Label + kontrol + bantuan/galat. Label terhubung lewat htmlFor, bantuan dan galat lewat aria-describedby,
// galat menandai aria-invalid. Rupa input diatur di sini (40px, HP 44px dengan font 16px).
export default function Field({ label, bantuan, galat, wajib, className, children }: FieldProps) {
  const dasar = useId();
  const adaGalat = galat !== undefined && galat !== null && galat !== false && galat !== '';
  const adaBantuan = bantuan !== undefined && bantuan !== null && bantuan !== false && bantuan !== '';
  const idBantuan = `${dasar}-bantuan`;
  const idGalat = `${dasar}-galat`;

  let id = `${dasar}-kontrol`;
  let kontrol: ReactNode;
  if (typeof children === 'function') {
    kontrol = children({
      id,
      'aria-describedby': describedBy(adaBantuan && idBantuan, adaGalat && idGalat),
      'aria-invalid': adaGalat ? true : undefined,
      'aria-required': wajib ? true : undefined,
    });
  } else if (isValidElement(children)) {
    const bawaan = children.props as { id?: string; 'aria-describedby'?: string };
    id = bawaan.id ?? id;
    kontrol = cloneElement(children, {
      id,
      'aria-describedby': describedBy(bawaan['aria-describedby'], adaBantuan && idBantuan, adaGalat && idGalat),
      'aria-invalid': adaGalat ? true : undefined,
      'aria-required': wajib ? true : undefined,
    });
  } else {
    kontrol = children;
  }

  return (
    <div className={cn(styles.field, adaGalat && styles.bergalat, className)}>
      <label htmlFor={id} className={styles.label}>
        {label}
        {wajib && (
          <span className={styles.wajib} aria-hidden="true">
            {' '}
            *
          </span>
        )}
      </label>
      {kontrol}
      {adaBantuan && (
        <p id={idBantuan} className={styles.bantuan}>
          {bantuan}
        </p>
      )}
      {adaGalat && (
        <p id={idGalat} className={styles.galat} role="alert">
          {galat}
        </p>
      )}
    </div>
  );
}

function describedBy(...ids: Array<string | false | undefined>): string | undefined {
  const daftar = ids.filter(Boolean).join(' ');
  return daftar || undefined;
}
