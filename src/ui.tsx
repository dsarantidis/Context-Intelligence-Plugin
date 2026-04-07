import { render, Container, Text, Button, VerticalSpace } from '@create-figma-plugin/ui';
import '!@create-figma-plugin/ui/css/base.css';

function Plugin() {
  return (
    <Container space="medium">
      <VerticalSpace space="small" />
      <Text>Plugin Status: Live</Text>
      <VerticalSpace space="small" />
      <Button fullWidth onClick={() => console.log('Ping')}>
        Apply description
      </Button>
    </Container>
  );
}

const mount = render(Plugin);

function run() {
  const root = document.getElementById('create-figma-plugin');
  if (root) mount(root, {});
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', run);
} else {
  run();
}

export default mount;
