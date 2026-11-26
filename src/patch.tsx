/**
 * Credit: decky-steamgriddb
 * https://github.com/SteamGridDB/decky-steamgriddb/blob/main/src/patches/contextMenuPatch.tsx
 */

import {
  afterPatch,
  type Export,
  fakeRenderComponent,
  findInReactTree,
  findInTree,
  findModuleByExport,
  MenuItem,
  Navigation,
  type Patch,
} from "@decky/ui";
import type { FC } from "react";

// Always add before "Properties..."
const spliceArtworkItem = (children: any[], appid: number) => {
  if (!Array.isArray(children)) return;
  handleItemDupes(children);
  const propertiesMenuItemIdx = children.findIndex((item) =>
    findInReactTree(item, (x) => x?.onSelected?.toString().includes("AppProperties")),
  );
  // Submenus (e.g. "Manage") have no "Properties...", so leave them alone.
  if (propertiesMenuItemIdx === -1) return;
  children.splice(
    propertiesMenuItemIdx,
    0,
    <MenuItem
      key="cheat-deck"
      onSelected={() => {
        Navigation.Navigate(`/cheatdeck/${appid}`);
      }}
    >
      CheatDeck
    </MenuItem>,
  );
};

// Check if correct menu by looking at the code of the onSelected function
// Should be enough to ignore the screenshots and other menus.
const isOpeningAppContextMenu = (items: any[]) => {
  if (!items?.length) {
    return false;
  }
  return !!findInReactTree(items, (x) => x?.props?.onSelected?.toString().includes("launchSource"));
};

// Steam sometimes passes children as a single element, not an array.
const handleItemDupes = (items: any[]) => {
  if (!Array.isArray(items)) return;
  for (let i = items.length - 1; i >= 0; i--) {
    if (items[i]?.key === "cheat-deck") items.splice(i, 1);
  }
};

const patchMenuItems = (menuItems: any[], appid: number) => {
  if (!Array.isArray(menuItems)) return;
  let updatedAppid: number = appid;
  // find the first menu component that has the correct appid, sometimes the one passed is cached from another context menu
  const parentOverview = menuItems.find(
    (x: any) => x?._owner?.pendingProps?.overview?.appid && x._owner.pendingProps.overview.appid !== appid,
  );
  // if found then use that appid
  if (parentOverview) {
    updatedAppid = parentOverview._owner.pendingProps.overview.appid;
  }
  // Oct 2025 client
  if (updatedAppid === appid) {
    const foundApp = findInTree(menuItems, (x) => x?.app?.appid, { walkable: ["props", "children"] });
    if (foundApp) {
      updatedAppid = foundApp.app.appid;
    }
  }
  spliceArtworkItem(menuItems, updatedAppid);
};

/**
 * Patches the game context menu.
 * @param LibraryContextMenu The game context menu.
 * @returns A patch to remove when the plugin dismounts.
 */
const contextMenuPatch = (LibraryContextMenu: any) => {
  const nested: Patch[] = [];
  const patchedTypes = new Set<any>();
  const patches: {
    outer?: Patch;
    inner?: Patch;
    unpatch: () => void;
  } = {
    unpatch: () => {
      return null;
    },
  };
  patches.outer = afterPatch(LibraryContextMenu.prototype, "render", (_: Record<string, unknown>[], component: any) => {
    let appid: number = 1018880;
    if (component._owner) {
      appid = component._owner.pendingProps.overview.appid;
    } else {
      // Oct 2025 client
      const foundApp = findInTree(component.props.children, (x) => x?.app?.appid, { walkable: ["props", "children"] });
      if (foundApp) {
        appid = foundApp.app.appid;
      }
    }

    if (!patches.inner) {
      patches.inner = afterPatch(component, "type", (_: any, ret: any) => {
        // Steam re-renders the same menu type, so only patch each one once
        if (patchedTypes.has(ret.type.prototype)) return ret;
        patchedTypes.add(ret.type.prototype);
        // initial render
        nested.push(
          afterPatch(ret.type.prototype, "render", (_: any, ret2: any) => {
            const menuItems = ret2.props.children[0]; // always the first child
            if (!isOpeningAppContextMenu(menuItems)) return ret2;
            try {
              handleItemDupes(menuItems);
            } catch (error) {
              return ret2;
            }
            patchMenuItems(menuItems, appid);
            return ret2;
          }),
        );

        // when steam decides to regresh app overview
        nested.push(
          afterPatch(ret.type.prototype, "shouldComponentUpdate", ([nextProps]: any, shouldUpdate: any) => {
            try {
              handleItemDupes(nextProps.children);
            } catch (error) {
              // wrong context menu (probably)
              return shouldUpdate;
            }

            if (shouldUpdate === true) {
              patchMenuItems(nextProps.children, appid);
            }

            return shouldUpdate;
          }),
        );
        return ret;
      });
    } else {
      spliceArtworkItem(component.props.children, appid);
    }
    return component;
  });
  patches.unpatch = () => {
    for (const patch of nested.splice(0).reverse()) patch.unpatch();
    patchedTypes.clear();
    patches.outer?.unpatch();
    patches.inner?.unpatch();
  };
  return patches;
};

/**
 * Game context menu component.
 */
export const LibraryContextMenu = fakeRenderComponent(
  Object.values(findModuleByExport((e: Export) => e?.toString?.().includes("().LibraryContextMenu"))).find((sibling) =>
    sibling?.toString().includes("navigator:"),
  ) as FC,
).type;

export default contextMenuPatch;
