/**
 * DS Context Intelligence UI – Final Rescue: minimal view to verify connection.
 * First line must be CSS (library provides base.css; no styles.css in package).
 */
import '!@create-figma-plugin/ui/css/base.css';
import { Container, Text, VerticalSpace, Button, IconButton, IconRefresh16 } from '@create-figma-plugin/ui';

function Plugin() {
  try {
    return (
      <Container space="medium">
        <VerticalSpace space="small" />
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Text style={{ fontWeight: 600, fontSize: 14 }}>DS Context Intelligence</Text>
          <IconButton onClick={() => {}} title="Rescan" aria-label="Rescan">
            <IconRefresh16 />
          </IconButton>
        </div>
        <VerticalSpace space="small" />
        <Text style={{ fontSize: 11, color: 'var(--figma-color-text-secondary)', display: 'block' }}>
          Page &gt; Component
        </Text>
        <VerticalSpace space="extraSmall" />
        <Button fullWidth onClick={() => {}}>
          Apply description
        </Button>
        <VerticalSpace space="medium" />
      </Container>
    );
  } catch (err) {
    console.error('DS Context Intelligence render error:', err);
    return <div>Error Loading UI</div>;
  }
}

export { Plugin };
