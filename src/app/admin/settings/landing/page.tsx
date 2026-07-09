'use client';

import { useState, useEffect, useCallback } from 'react';
import Link from 'next/link';
import {
  ArrowLeft,
  Save,
  Loader2,
  ChevronUp,
  ChevronDown,
  LayoutTemplate,
} from 'lucide-react';
import PageHeader from '@/components/layout/PageHeader';
import { createClient } from '@/lib/supabase/client';
import { useToast } from '@/components/Toast';
import styles from './landing.module.css';

interface LandingItem {
  id: string;
  section: string;
  item_key: string;
  item_value: string | null;
  item_order: number;
  is_active: boolean;
}

const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero',
  section_header: 'Section Header',
  service: 'Layanan',
  cta: 'Call to Action',
  footer: 'Footer',
};

const SECTION_ORDER = ['hero', 'section_header', 'service', 'cta', 'footer'];

const TEXTAREA_KEYS = new Set(['description', 'jawaban', 'copyright']);

export default function LandingContentEditorPage() {
  const { toast } = useToast();
  const [items, setItems] = useState<LandingItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<string>('');
  const [savingSection, setSavingSection] = useState<string | null>(null);

  const fetchContent = useCallback(async () => {
    setLoading(true);
    try {
      const supabase = createClient();
      const { data, error } = await supabase
        .from('landing_content')
        .select('*')
        .order('section', { ascending: true })
        .order('item_order', { ascending: true });

      if (error) throw error;

      const rows = (data || []) as LandingItem[];
      setItems(rows);

      const firstSection = SECTION_ORDER.find((s) =>
        rows.some((r) => r.section === s)
      );
      if (firstSection) {
        setActiveTab(firstSection);
      }
    } catch {
      toast('Gagal memuat konten landing page.', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    fetchContent();
  }, [fetchContent]);

  const sections = Array.from(new Set(items.map((i) => i.section))).sort(
    (a, b) => SECTION_ORDER.indexOf(a) - SECTION_ORDER.indexOf(b)
  );

  const getSectionItems = (section: string) =>
    items.filter((i) => i.section === section);

  const updateItem = (id: string, field: keyof LandingItem, value: string | number | boolean) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, [field]: value } : item
      )
    );
  };

  const handleReorderService = (serviceIndex: number, direction: 'up' | 'down') => {
    const serviceItems = getSectionItems('service');
    const orders = Array.from(new Set(serviceItems.map((s) => s.item_order))).sort(
      (a, b) => a - b
    );
    const currentOrder = serviceItems[serviceIndex].item_order;
    const orderIdx = orders.indexOf(currentOrder);
    const targetOrder = direction === 'up' ? orders[orderIdx - 1] : orders[orderIdx + 1];
    if (targetOrder === undefined) return;

    const currentIds = serviceItems
      .filter((s) => s.item_order === currentOrder)
      .map((s) => s.id);
    const targetIds = serviceItems
      .filter((s) => s.item_order === targetOrder)
      .map((s) => s.id);

    setItems((prev) =>
      prev.map((item) => {
        if (currentIds.includes(item.id)) {
          return { ...item, item_order: targetOrder };
        }
        if (targetIds.includes(item.id)) {
          return { ...item, item_order: currentOrder };
        }
        return item;
      })
    );
  };

  const handleSaveSection = async (section: string) => {
    setSavingSection(section);
    const sectionItems = getSectionItems(section);

    try {
      const supabase = createClient();
      const updates = sectionItems.map((item) =>
        supabase
          .from('landing_content')
          .update({
            item_value: item.item_value,
            is_active: item.is_active,
            item_order: item.item_order,
          })
          .eq('id', item.id)
      );

      const results = await Promise.all(updates);
      const hasError = results.some((r) => r.error);
      if (hasError) throw new Error('Update failed');

      toast(`Konten "${SECTION_LABELS[section] || section}" berhasil disimpan!`, 'success');
    } catch {
      toast('Gagal menyimpan konten. Silakan coba lagi.', 'error');
    } finally {
      setSavingSection(null);
    }
  };

  const renderField = (item: LandingItem) => {
    const isTextarea = TEXTAREA_KEYS.has(item.item_key);
    const label = item.item_key.replace(/_/g, ' ');

    return (
      <div key={item.id} className="form-group">
        <label className="form-label" style={{ textTransform: 'capitalize' }}>
          {label}
        </label>
        {isTextarea ? (
          <textarea
            className="form-textarea"
            rows={3}
            value={item.item_value || ''}
            onChange={(e) => updateItem(item.id, 'item_value', e.target.value)}
          />
        ) : (
          <input
            type="text"
            className="form-input"
            value={item.item_value || ''}
            onChange={(e) => updateItem(item.id, 'item_value', e.target.value)}
          />
        )}
      </div>
    );
  };

  const renderServiceEditor = () => {
    const serviceItems = getSectionItems('service');
    const orders = Array.from(new Set(serviceItems.map((s) => s.item_order))).sort(
      (a, b) => a - b
    );

    return (
      <div className={styles.serviceCards}>
        {orders.map((order, orderIdx) => {
          const cardItems = serviceItems.filter((s) => s.item_order === order);
          const titleItem = cardItems.find((s) => s.item_key === 'title');
          return (
            <div key={order} className={styles.serviceCard}>
              <div className={styles.serviceCardHeader}>
                <div className={styles.serviceCardTitle}>
                  <span className={styles.serviceOrderBadge}>{order}</span>
                  {titleItem?.item_value || `Service ${order}`}
                </div>
                <div className={styles.serviceReorder}>
                  <button
                    type="button"
                    className={styles.reorderBtn}
                    onClick={() => handleReorderService(orderIdx, 'up')}
                    disabled={orderIdx === 0}
                    aria-label="Move up"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    type="button"
                    className={styles.reorderBtn}
                    onClick={() => handleReorderService(orderIdx, 'down')}
                    disabled={orderIdx === orders.length - 1}
                    aria-label="Move down"
                  >
                    <ChevronDown size={16} />
                  </button>
                </div>
              </div>

              <div className={styles.fieldGrid}>
                {cardItems.map((item) => (
                  <div
                    key={item.id}
                    className={
                      item.item_key === 'description'
                        ? styles.fieldGridFull
                        : ''
                    }
                  >
                    <div className="form-group">
                      <label className="form-label" style={{ textTransform: 'capitalize' }}>
                        {item.item_key}
                      </label>
                      {item.item_key === 'description' ? (
                        <textarea
                          className="form-textarea"
                          rows={2}
                          value={item.item_value || ''}
                          onChange={(e) => updateItem(item.id, 'item_value', e.target.value)}
                        />
                      ) : (
                        <input
                          type="text"
                          className="form-input"
                          value={item.item_value || ''}
                          onChange={(e) => updateItem(item.id, 'item_value', e.target.value)}
                        />
                      )}
                    </div>
                  </div>
                ))}
              </div>

              <div className={styles.toggleRow}>
                <label className={styles.toggleSwitch}>
                  <input
                    type="checkbox"
                    checked={cardItems[0]?.is_active ?? true}
                    onChange={(e) => {
                      const ids = cardItems.map((c) => c.id);
                      setItems((prev) =>
                        prev.map((item) =>
                          ids.includes(item.id)
                            ? { ...item, is_active: e.target.checked }
                            : item
                        )
                      );
                    }}
                  />
                  <span className={styles.toggleSlider} />
                </label>
                <span className={styles.toggleLabel}>Aktif</span>
              </div>
            </div>
          );
        })}
      </div>
    );
  };

  if (loading) {
    return (
      <>
        <PageHeader
          title="Konten Landing Page"
          description="Edit konten yang ditampilkan di halaman utama"
        />
        <div className={styles.landingPage}>
          <div className={styles.loadingState}>
            <Loader2 size={20} className="animate-spin" />
            Memuat konten...
          </div>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Konten Landing Page"
        description="Edit konten yang ditampilkan di halaman utama"
      />

      <div className={styles.landingPage}>
        <Link href="/admin/settings" className={styles.backLink}>
          <ArrowLeft size={16} />
          Kembali ke Pengaturan
        </Link>

        {sections.length === 0 ? (
          <div className={styles.loadingState}>
            <LayoutTemplate size={24} />
            Tidak ada konten landing page ditemukan.
          </div>
        ) : (
          <>
            <div className={styles.tabBar}>
              {sections.map((section) => (
                <button
                  key={section}
                  type="button"
                  className={`${styles.tab} ${activeTab === section ? styles.tabActive : ''}`}
                  onClick={() => setActiveTab(section)}
                >
                  {SECTION_LABELS[section] || section}
                </button>
              ))}
            </div>

            {sections.map((section) => {
              if (section !== activeTab) return null;

              return (
                <div key={section} className={styles.sectionPanel}>
                  <h3 className={styles.sectionTitle}>
                    {SECTION_LABELS[section] || section}
                  </h3>

                  {section === 'service' ? (
                    renderServiceEditor()
                  ) : (
                    <div className={styles.fieldGrid}>
                      {getSectionItems(section).map((item) => (
                        <div
                          key={item.id}
                          className={
                            TEXTAREA_KEYS.has(item.item_key)
                              ? styles.fieldGridFull
                              : ''
                          }
                        >
                          {renderField(item)}
                        </div>
                      ))}
                    </div>
                  )}

                  {section !== 'service' && (
                    <div className={styles.toggleRow}>
                      <label className={styles.toggleSwitch}>
                        <input
                          type="checkbox"
                          checked={getSectionItems(section)[0]?.is_active ?? true}
                          onChange={(e) => {
                            const ids = getSectionItems(section).map((i) => i.id);
                            setItems((prev) =>
                              prev.map((item) =>
                                ids.includes(item.id)
                                  ? { ...item, is_active: e.target.checked }
                                  : item
                              )
                            );
                          }}
                        />
                        <span className={styles.toggleSlider} />
                      </label>
                      <span className={styles.toggleLabel}>Tampilkan di landing page</span>
                    </div>
                  )}

                  <div className={styles.saveBar}>
                    <button
                      type="button"
                      className="btn btn--primary"
                      onClick={() => handleSaveSection(section)}
                      disabled={savingSection === section}
                    >
                      {savingSection === section ? (
                        <>
                          <Loader2 size={16} className="animate-spin" />
                          Menyimpan...
                        </>
                      ) : (
                        <>
                          <Save size={16} />
                          Simpan Perubahan
                        </>
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </>
        )}
      </div>
    </>
  );
}
