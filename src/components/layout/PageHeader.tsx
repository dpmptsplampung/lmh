import styles from './PageHeader.module.css';

interface PageHeaderProps {
  title: string;
  description?: string;
  children?: React.ReactNode;
}

export default function PageHeader({ title, description, children }: PageHeaderProps) {
  return (
    <div className={styles.header}>
      <div className={styles.headerLeft}>
        <h1 className={styles.headerTitle}>{title}</h1>
        {description && (
          <p className={styles.headerDescription}>{description}</p>
        )}
      </div>
      {children && (
        <div className={styles.headerRight}>{children}</div>
      )}
    </div>
  );
}
