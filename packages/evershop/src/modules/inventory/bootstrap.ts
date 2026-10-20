import { addProcessor } from '@evershop/evershop/lib/util/registry';

export default () => {
  addProcessor('inventoryLoader', () => {
    // Placeholder for future inventory loader integration
  }, 0);
  addProcessor('inventoryValidator', () => {
    // Placeholder for future inventory validator integration
  }, 0);
};