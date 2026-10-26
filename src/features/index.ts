import { bridgeFeature } from './bridge';
import { cmdlineFeature } from './cmdline';
import { cursorFeature } from './cursor';
import { FeatureDefinition } from './feature';
import { floatOverlayFeature } from './floats';
import { fileCommandsFeature } from './fileCommands';
import { inputFeature } from './input';
import { messagesFeature } from './messages';
import { modeFeature } from './mode';
import { navigationFeature } from './navigation';
import { optionSyncFeature } from './optionSync';
import { searchHighlightFeature } from './searchHighlight';
import { statuslineFeature } from './statusline';
import { surfaceFeature } from './surface';
import { viewportFeature } from './viewport';

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
  floatOverlayFeature,
  surfaceFeature,
];
