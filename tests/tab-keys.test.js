// 分頁列方向鍵（M12）：純函式 nextTabIndex
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextTabIndex } from '../src/ui/tabKeys.js';

test('左右方向鍵繞圈、Home／End 到頭尾、其他鍵不處理', () => {
  assert.equal(nextTabIndex('ArrowRight', 0, 3), 1);
  assert.equal(nextTabIndex('ArrowRight', 2, 3), 0);
  assert.equal(nextTabIndex('ArrowLeft', 0, 3), 2);
  assert.equal(nextTabIndex('ArrowLeft', 2, 3), 1);
  assert.equal(nextTabIndex('Home', 2, 3), 0);
  assert.equal(nextTabIndex('End', 0, 3), 2);
  assert.equal(nextTabIndex('Enter', 0, 3), null);
  assert.equal(nextTabIndex('ArrowRight', 0, 0), null);
});
