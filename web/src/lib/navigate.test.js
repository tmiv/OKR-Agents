import test from 'node:test';
import assert from 'node:assert/strict';
import {
  rootOf, parentOf, firstChildOf, childrenOf, siblingOf, neighborhoodOf, step
} from './navigate.js';

// Six nodes: a root, two objectives, three KRs under the first objective.
// Deliberately not in tree order in the array — sibling order is array order,
// and the interleaving proves the filters, not the layout, pick the siblings.
const tree = {
  nodes: [
    { id: 'root', parent: null },
    { id: 'obj-a', parent: 'root' },
    { id: 'kr-1', parent: 'obj-a' },
    { id: 'obj-b', parent: 'root' },
    { id: 'kr-2', parent: 'obj-a' },
    { id: 'kr-3', parent: 'obj-a' }
  ]
};

test('rootOf finds the one node with a null parent', () => {
  assert.equal(rootOf(tree).id, 'root');
  assert.equal(rootOf({ nodes: [] }), null);
});

test('parent of a KR is its objective, and the root has no parent', () => {
  assert.equal(parentOf(tree, 'kr-2').id, 'obj-a');
  assert.equal(parentOf(tree, 'root'), null);
});

test('first child is the first in array order', () => {
  assert.equal(firstChildOf(tree, 'root').id, 'obj-a');
  assert.equal(firstChildOf(tree, 'obj-a').id, 'kr-1');
  assert.equal(firstChildOf(tree, 'kr-3'), null);
});

test('siblings walk array order', () => {
  assert.equal(siblingOf(tree, 'kr-1', 1).id, 'kr-2');
  assert.equal(siblingOf(tree, 'kr-2', 1).id, 'kr-3');
  assert.equal(siblingOf(tree, 'obj-b', -1).id, 'obj-a');
});

test('siblings wrap at both ends', () => {
  assert.equal(siblingOf(tree, 'kr-3', 1).id, 'kr-1');
  assert.equal(siblingOf(tree, 'kr-1', -1).id, 'kr-3');
  assert.equal(siblingOf(tree, 'obj-b', 1).id, 'obj-a');
  assert.equal(siblingOf(tree, 'obj-a', -1).id, 'obj-b');
});

test('a full lap returns to where it started', () => {
  let id = 'kr-1';
  for (let i = 0; i < 3; i++) id = siblingOf(tree, id, 1).id;
  assert.equal(id, 'kr-1');
  for (let i = 0; i < 3; i++) id = siblingOf(tree, id, -1).id;
  assert.equal(id, 'kr-1');
});

test('an only child has nowhere to wrap to, so left and right are no-ops', () => {
  // the root is the only node with a null parent
  assert.equal(siblingOf(tree, 'root', 1), null);
  assert.equal(siblingOf(tree, 'root', -1), null);
  // and so is a lone key result under its objective
  const lonely = { nodes: [{ id: 'r', parent: null }, { id: 'only', parent: 'r' }] };
  assert.equal(siblingOf(lonely, 'only', 1), null);
  assert.equal(siblingOf(lonely, 'only', -1), null);
});

test('with nothing selected every arrow selects the root', () => {
  for (const dir of ['up', 'down', 'left', 'right']) {
    assert.equal(step(tree, null, dir).id, 'root');
  }
});

test('a selection that is no longer in the tree falls back to the root', () => {
  assert.equal(step(tree, 'deleted-node', 'up').id, 'root');
});

test('step maps the four arrows onto the walk', () => {
  assert.equal(step(tree, 'kr-2', 'up').id, 'obj-a');
  assert.equal(step(tree, 'obj-a', 'down').id, 'kr-1');
  assert.equal(step(tree, 'kr-1', 'right').id, 'kr-2');
  assert.equal(step(tree, 'kr-2', 'left').id, 'kr-1');
});

test('up and down still stop at the ends; left and right wrap', () => {
  assert.equal(step(tree, 'root', 'up'), null);
  assert.equal(step(tree, 'kr-3', 'down'), null);
  assert.equal(step(tree, 'kr-3', 'right').id, 'kr-1');
  assert.equal(step(tree, 'kr-1', 'left').id, 'kr-3');
});

// Compared as sets: `neighborhoodOf` documents its order as "no particular".
const set = (ids) => new Set(ids);

test('children are every node pointing at the id, and a leaf has none', () => {
  assert.deepEqual(set(childrenOf(tree, 'obj-a').map((n) => n.id)), set(['kr-1', 'kr-2', 'kr-3']));
  assert.deepEqual(childrenOf(tree, 'obj-b'), []);
});

test('a neighbourhood is the node, its parent, and its direct children', () => {
  assert.deepEqual(
    set(neighborhoodOf(tree, 'obj-a')),
    set(['root', 'obj-a', 'kr-1', 'kr-2', 'kr-3'])
  );
});

test('a leaf frames itself and its parent', () => {
  assert.deepEqual(set(neighborhoodOf(tree, 'kr-2')), set(['kr-2', 'obj-a']));
});

test('the root has no parent to add', () => {
  assert.deepEqual(set(neighborhoodOf(tree, 'root')), set(['root', 'obj-a', 'obj-b']));
});

test('an id that is not in the tree frames nothing', () => {
  assert.deepEqual(neighborhoodOf(tree, 'gone'), []);
});
