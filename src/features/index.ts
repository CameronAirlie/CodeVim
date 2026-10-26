import { bridgeFeature } from './bridge';
import { cmdlineFeature } from './cmdline';
import { cursorFeature } from './cursor';
import { FeatureDefinition } from './feature';
import { floatOverlayFeature } from './floats';
import { fileCommandsFeature } from './fileCommands';
import { foldingFeature } from './folding';
import { inputFeature } from './input';
import { jumplistFeature } from './jumplist';
import { messagesFeature } from './messages';
import { modeFeature } from './mode';
import { navigationFeature } from './navigation';
import { optionSyncFeature } from './optionSync';
import { searchHighlightFeature } from './searchHighlight';
import { statuslineFeature } from './statusline';
import { surfaceFeature } from './surface';
import { undoFeature } from './undo';
import { viewportFeature } from './viewport';
import { virtualSpaceFeature } from './virtualSpace';

/** All features, in activation order. Add new features here. */
export const FEATURES: readonly FeatureDefinition[] = [
  modeFeature,
  bridgeFeature,
  fileCommandsFeature,
  cursorFeature,
  navigationFeature,
  inputFeature,
  viewportFeature,
  cmdlineFeature,
  messagesFeature,
  statuslineFeature,
  searchHighlightFeature,
  optionSyncFeature,
  foldingFeature,
  jumplistFeature,
  undoFeature,
  virtualSpaceFeature,
  floatOverlayFeature,
  surfaceFeature,
];
