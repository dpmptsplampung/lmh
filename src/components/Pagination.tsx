'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';

interface PaginationProps {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}

export default function Pagination({ page, pageSize, total, onPageChange }: PaginationProps) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.min(page, totalPages - 1);

  if (total === 0) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--space-4)',
        padding: 'var(--space-3) var(--space-4)',
        borderTop: '1px solid var(--border-default)',
        flexWrap: 'wrap',
      }}
    >
      <span style={{ fontSize: 'var(--text-sm)', color: 'var(--text-secondary)' }}>
        Halaman {currentPage + 1} dari {totalPages} • total {total} data
      </span>
      <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => onPageChange(currentPage - 1)}
          disabled={currentPage <= 0}
          aria-label="Halaman sebelumnya"
        >
          <ChevronLeft size={14} />
          Sebelumnya
        </button>
        <button
          type="button"
          className="btn btn--secondary btn--sm"
          onClick={() => onPageChange(currentPage + 1)}
          disabled={currentPage >= totalPages - 1}
          aria-label="Halaman berikutnya"
        >
          Berikutnya
          <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}
