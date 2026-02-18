/**
 * Builds the User Settings section of the overlay.
 * @param {object} deps - Dependency bag used inside the settings UI.
 * @param {import('./Overlay.js').default} deps.overlay - Overlay builder instance.
 * @param {import('./templateManager.js').default} deps.templateManager - Template manager.
 * @param {import('./apiManager.js').default} deps.apiManager - API manager.
 * @param {object} deps.layoutThemeOptions - Layout theme options map.
 * @param {object} deps.templateDisplayOptions - Template display options map.
 * @param {(value: string) => string} deps.normalizeLayoutTheme - Normalizes layout theme value.
 * @param {(value: string) => string} deps.normalizeTemplateDisplay - Normalizes template display value.
 * @param {(value: string) => void} deps.applyLayoutTheme - Applies layout theme to DOM.
 * @param {() => void} deps.forceUpdateTheme - Forces template theme update.
 * @param {() => void} deps.buildColorFilterList - Rebuilds the color filter list.
 * @param {() => void} deps.buildTemplateFilterList - Rebuilds the template filter list.
 * @param {() => void} deps.buildEventList - Rebuilds the event list.
 * @param {(value?: boolean) => void} deps.forceRefreshTiles - Forces map tile refresh.
 * @param {(layer: string) => void} deps.removeLayer - Removes map layer by id.
 * @param {(enabled: boolean) => void} deps.setMapCommentsEnabled - Enables/disables map comments on the map layer.
 * @param {object} deps.themeList - Available theme list.
 * @param {string} deps.outputStatusId - Element id for the status output.
 * @returns {import('./Overlay.js').default} Overlay builder instance for chaining.
 */
export function buildUserSettingsSection({
  overlay,
  templateManager,
  apiManager,
  layoutThemeOptions,
  templateDisplayOptions,
  normalizeLayoutTheme,
  normalizeTemplateDisplay,
  applyLayoutTheme,
  forceUpdateTheme,
  buildColorFilterList,
  buildTemplateFilterList,
  buildEventList,
  forceRefreshTiles,
  removeLayer,
  setMapCommentsEnabled,
  themeList,
  outputStatusId,
}) {
  const callBuildColorFilterList = () => buildColorFilterList?.();
  const callBuildTemplateFilterList = () => buildTemplateFilterList?.();
  const callBuildEventList = () => buildEventList?.();

  return overlay
    .addDetails({'id': 'bm-checkbox-container', 'textContent': 'User Settings', 'style': 'max-width: 100%; white-space: nowrap; border: 1px solid var(--bm-border); padding: 4px; border-radius: 4px; margin-top: 4px;'})
      .addDiv({'id': 'bm-user_setting-list', 'style': 'max-height: 125px; overflow-x: hidden; overflow-y: auto; touch-action: pan-x pan-y; display: flex; flex-direction: column; gap: 4px; margin-top: 3px;'})
        .addCheckbox({'id': 'bm-only-current-color-enabled', 'textContent': 'Show Current Color Only', 'checked': templateManager.isOnlyCurrentColorShown()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setOnlyCurrentColorShown(checkbox.checked);
            if (checkbox.checked) {
              instance.handleDisplayStatus("Only the currently selected color will be shown.");
              callBuildColorFilterList();
            } else {
              instance.handleDisplayStatus("Color filter is restored.");
              callBuildColorFilterList();
            };
            templateManager.createOverlayOnMap();
            if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
              forceRefreshTiles();
            };
            callBuildColorFilterList();
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-checkbox-colors-unlocked', 'textContent': 'Hide Locked Colors', 'checked': templateManager.areLockedColorsHidden()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setHideLockedColors(checkbox.checked);
            callBuildColorFilterList();
            templateManager.createOverlayOnMap();
            if (checkbox.checked) {
              instance.handleDisplayStatus("Hidden all locked colors.");
            } else {
              instance.handleDisplayStatus("Restored all colors.");
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-checkbox-colors-completed', 'textContent': 'Hide Completed Colors', 'checked': templateManager.areCompletedColorsHidden()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setHideCompletedColors(checkbox.checked);
            callBuildColorFilterList();
            templateManager.createOverlayOnMap();
            if (checkbox.checked) {
              instance.handleDisplayStatus("Hidden all completed colors.");
            } else {
              instance.handleDisplayStatus("Restored all colors.");
            }
            if (templateManager.isErrorMapShown() && templateManager.isErrorMapOnlyEnabledColorsShown()) {
              forceRefreshTiles();
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-template-list-remaining', 'textContent': 'Show Remaining Count', 'checked': templateManager.isTemplateListRemainingEnabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setTemplateListRemainingEnabled(checkbox.checked);
            callBuildTemplateFilterList();
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-show-error-map', 'textContent': 'Show Error Map', 'checked': templateManager.isErrorMapShown()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setErrorMapShown(checkbox.checked);
            document.getElementById('bm-show-only-enabled-colors-on-error-map').parentElement.style.display = checkbox.checked ? '' : 'none';
            if (checkbox.checked) {
              instance.handleDisplayStatus("Error Map is now Displayed.");
              apiManager.tileCache = {};
              forceRefreshTiles();
            } else {
              instance.handleDisplayStatus("Error Map is now Hidden.");
              removeLayer("error");
            };
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-show-only-enabled-colors-on-error-map', 'textContent': 'Only Enabled Colors on Error Map', 'checked': templateManager.isErrorMapOnlyEnabledColorsShown()}, (instance, label, checkbox) => {
          label.style.paddingLeft = '1em';
          if (templateManager.isErrorMapShown()) {
            label.style.display = '';
          } else {
            label.style.display = 'none';
          }
          checkbox.addEventListener('change', () => {
            templateManager.setErrorMapOnlyEnabledColorsShown(checkbox.checked);
            if (checkbox.checked) {
              instance.handleDisplayStatus("Error Map now only shows enabled colors.");
            } else {
              instance.handleDisplayStatus("Error Map now shows every pixel involved in the template.");
            };
            apiManager.tileCache = {};
            forceRefreshTiles();
          });
        }).buildElement()
        .addDiv({'className': 'bm-setting-row'})
          .addSpan({'textContent': 'Layout Theme:'}).buildElement()
          .addSelect({'id': 'bm-layout-theme'}, (instance, select) => {
            const currentLayoutTheme = normalizeLayoutTheme(templateManager.getLayoutTheme());
            Object.entries(layoutThemeOptions).forEach(([value, label]) => {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = label;
              if (value === currentLayoutTheme) {
                option.selected = true;
              }
              select.appendChild(option);
            });
            select.addEventListener('change', async () => {
              const nextTheme = normalizeLayoutTheme(select.value);
              await templateManager.setLayoutTheme(nextTheme);
              applyLayoutTheme(nextTheme);
              instance.handleDisplayStatus(`Layout theme set to "${layoutThemeOptions[nextTheme]}".`);
            });
          }).buildElement()
        .buildElement()
        .addCheckbox({'id': 'bm-theme-override-enabled', 'textContent': 'Theme Override: ', 'checked': templateManager.isThemeOverridden()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', async () => {
            await templateManager.setThemeOverridden(checkbox.checked);
            const select = document.getElementById('bm-theme-setting');
            select.disabled = !checkbox.checked;
            forceUpdateTheme();
          });
        })
          .addSelect({'id': 'bm-theme-setting'}, (instance, select) => {
            const currentTheme = templateManager.getCurrentTheme();
            Object.entries(themeList).forEach(([themeValue, [displayText]]) => {
              const option = document.createElement('option');
              option.value = themeValue;
              option.textContent = displayText;
              if (themeValue === currentTheme) { option.selected = true; }
              select.appendChild(option);
            });
            select.addEventListener('change', async () => {
              await templateManager.setCurrentTheme(select.value);
              instance.handleDisplayStatus(`Changed the theme to "${themeList[select.value][0]}".`);
              forceUpdateTheme();
            })
          }).buildElement()
        .buildElement()
        .addCheckbox({'id': 'bm-event-enabled', 'textContent': 'Enable Event', 'checked': templateManager.isEventEnabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setEventEnabled(checkbox.checked);
            if (checkbox.checked) {
              instance.handleDisplayStatus("Event Mode Enabled.");
              document.getElementById('bm-contain-eventitem').style.display = '';
              document.getElementById('bm-event-hide-claimed').parentElement.style.display = '';
              document.getElementById('bm-event-hide-unavailable').parentElement.style.display = '';
              apiManager.refreshEventData();
              callBuildEventList();
            } else {
              instance.handleDisplayStatus("Event Mode Disabled.");
              document.getElementById('bm-contain-eventitem').style.display = 'none';
              document.getElementById('bm-event-hide-claimed').parentElement.style.display = 'none';
              document.getElementById('bm-event-hide-unavailable').parentElement.style.display = 'none';
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-event-hide-claimed', 'textContent': 'Hide Claimed Event Items', 'checked': !templateManager.isEventClaimedShown()}, (instance, label, checkbox) => {
          label.style.paddingLeft = '1em';
          if (templateManager.isEventEnabled()) {
            label.style.display = '';
          } else {
            label.style.display = 'none';
          }
          checkbox.addEventListener('change', () => {
            templateManager.setEventClaimedShown(!checkbox.checked);
            if (checkbox.checked) {
              instance.handleDisplayStatus("Hidden All Event Claimed Items.");
            } else {
              instance.handleDisplayStatus("Restored All Event Claimed Items.");
            }
            callBuildEventList();
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-event-hide-unavailable', 'textContent': 'Hide Unavailable Event Items', 'checked': !templateManager.isEventUnavailableShown()}, (instance, label, checkbox) => {
          label.style.paddingLeft = '1em';
          if (templateManager.isEventEnabled()) {
            label.style.display = '';
          } else {
            label.style.display = 'none';
          }
          checkbox.addEventListener('change', () => {
            templateManager.setEventUnavailableShown(!checkbox.checked);
            if (checkbox.checked) {
              instance.handleDisplayStatus("Hidden All Unavailable Event Items.");
            } else {
              instance.handleDisplayStatus("Restored All Unavailable Event Items.");
            }
            callBuildEventList();
          });
        }).buildElement()
        .addDiv({'className': 'bm-setting-row'})
          .addSpan({'textContent': 'Template Display:'}).buildElement()
          .addSelect({'id': 'bm-template-display'}, (instance, select) => {
            const currentDisplay = normalizeTemplateDisplay(templateManager.getTemplateDisplayMode());
            Object.entries(templateDisplayOptions).forEach(([value, label]) => {
              const option = document.createElement('option');
              option.value = value;
              option.textContent = label;
              if (value === currentDisplay) {
                option.selected = true;
              }
              select.appendChild(option);
            });
            select.addEventListener('change', async () => {
              const nextMode = normalizeTemplateDisplay(select.value);
              await templateManager.setTemplateDisplayMode(nextMode);
              if (nextMode === 'dot') {
                instance.handleDisplayStatus("Switched to the Dot Template Display.");
              } else if (nextMode === 'fill') {
                instance.handleDisplayStatus("Switched to the Fill Template Display.");
              } else if (nextMode.startsWith('cross-z')) {
                instance.handleDisplayStatus("Switched to the Z-Cross Template Display.");
              } else {
                instance.handleDisplayStatus("Switched to the Cross Template Display.");
              }
              templateManager.createOverlayOnMap();
            });
          }).buildElement()
        .buildElement()
        .addCheckbox({'id': 'bm-show-zoom-buttons', 'textContent': 'Show Integer Zoom Buttons', 'checked': templateManager.areIntegerZoomButtonsShown()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setIntegerZoomButtonsShown(checkbox.checked);
            const concernedElements = Array.from(document.getElementsByClassName('bm-zoom-btn'));
            if (checkbox.checked) {
              instance.handleDisplayStatus("Integer Zoom Buttons are now Displayed.");
              concernedElements.forEach(button => button.style.display = '');
            } else {
              instance.handleDisplayStatus("Integer Zoom Buttons are now Hidden.");
              concernedElements.forEach(button => button.style.display = 'none');
            };
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-enable-keybinds', 'textContent': 'Enable WASD Keybinds', 'checked': templateManager.areKeybindsEnabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setKeybindsEnabled(checkbox.checked);
            if (checkbox.checked) {
              instance.handleDisplayStatus("WASD Keybinds are now Enabled.");
            } else {
              instance.handleDisplayStatus("WASD Keybinds are now Disabled.");
            };
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-chat-enabled', 'textContent': 'Enable Chat', 'checked': !templateManager.isChatDisabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            const enabled = checkbox.checked;
            templateManager.setChatDisabled(!enabled);
            instance.handleDisplayStatus(enabled ? "Chat is now Enabled." : "Chat is now Disabled.");
            if (typeof window.setChatEnabled === 'function') {
              window.setChatEnabled(enabled);
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-map-comments-enabled', 'textContent': 'Enable Map Comments', 'checked': templateManager.isMapCommentsEnabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', async () => {
            const enabled = checkbox.checked;
            await templateManager.setMapCommentsEnabled(enabled);
            if (typeof setMapCommentsEnabled === 'function') {
              setMapCommentsEnabled(enabled);
            }
            instance.handleDisplayStatus(enabled ? "Map comments are now Enabled." : "Map comments are now Disabled.");
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-enable-line-template', 'textContent':  'Shape Templates (Experimental)', 'checked': templateManager.isLineTemplateButtonShown()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setLineTemplateButtonEnabled(checkbox.checked);
            if (checkbox.checked) {
              apiManager.updateAddLineTemplateButton();
              apiManager.updateAddCircleTemplateButton();
              instance.handleDisplayStatus("The Line and Circle Template Buttons are now Shown in Pixel Info.");
            } else {
              const btnLineTemplate = document.getElementById('bm-create-line-template');
              if (btnLineTemplate) {
                btnLineTemplate.remove();
              }
              const btnCircleTemplate = document.getElementById('bm-create-circle-template');
              if (btnCircleTemplate) {
                btnCircleTemplate.remove();
              }
              instance.handleDisplayStatus("The Line and Circle Template Buttons are now Hidden from Pixel Info.");
            };
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-ruspixel-flag-enabled', 'textContent': 'Ruspixel Flag in Pixel Info', 'checked': templateManager.isRuspixelFlagEnabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setRuspixelFlagEnabled(checkbox.checked);
            apiManager.updatePixelInfoAllianceBackground();
            if (checkbox.checked) {
              instance.handleDisplayStatus("Ruspixel flag background enabled for Pixel Info.");
            } else {
              instance.handleDisplayStatus("Ruspixel flag background disabled for Pixel Info.");
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-auto-sync-templates', 'textContent': 'Auto Update Templates', 'checked': templateManager.isTemplateAutoSyncEnabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setTemplateAutoSyncEnabled(checkbox.checked);
            if (checkbox.checked) {
              instance.handleDisplayStatus("Auto update enabled: templates will sync automatically.");
            } else {
              instance.handleDisplayStatus("Auto update disabled.");
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-progress-bar-enabled', 'textContent': 'Show Progress Bar', 'checked': templateManager.isProgressBarEnabled()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setProgressBarEnabled(checkbox.checked);
            callBuildColorFilterList();
            if (checkbox.checked) {
              instance.handleDisplayStatus("Progress Bar Enabled.");
            } else {
              instance.handleDisplayStatus("Progress Bar Disabled.");
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-hide-user-droplets', 'textContent': 'Hide Droplets', 'checked': templateManager.isDropletsHidden()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setDropletsHidden(checkbox.checked);
            const dropletsRow = document.getElementById('bm-user-droplets-row');
            if (dropletsRow) {
              dropletsRow.style.display = checkbox.checked ? 'none' : '';
            }
            if (checkbox.checked) {
              instance.handleDisplayStatus("Droplets Hidden.");
            } else {
              instance.handleDisplayStatus("Droplets Restored.");
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-hide-user-nextlevel', 'textContent': 'Hide Next Level', 'checked': templateManager.isNextLevelHidden()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setNextLevelHidden(checkbox.checked);
            const nextLevelRow = document.getElementById('bm-user-nextlevel-row');
            if (nextLevelRow) {
              nextLevelRow.style.display = checkbox.checked ? 'none' : '';
            }
            if (checkbox.checked) {
              instance.handleDisplayStatus("Next Level Hidden.");
            } else {
              instance.handleDisplayStatus("Next Level Restored.");
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-status-hidden', 'textContent': 'Hide Status Display', 'checked': templateManager.isStatusHidden()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setStatusHidden(checkbox.checked);
            const statusElement = document.getElementById(outputStatusId);
            if (checkbox.checked) {
              instance.handleDisplayStatus("Status Display Hidden.");
              if (statusElement) {
                statusElement.style.display = 'none';
              }
            } else {
              instance.handleDisplayStatus("Status Display Restored.");
              if (statusElement) {
                statusElement.style.display = '';
              }
            }
          });
        }).buildElement()
        .addCheckbox({'id': 'bm-memory-saving-enabled', 'textContent': 'Memory-Saving Mode (Experimental)', 'checked': templateManager.isMemorySavingModeOn()}, (instance, label, checkbox) => {
          checkbox.addEventListener('change', () => {
            templateManager.setMemorySavingMode(checkbox.checked);
            callBuildColorFilterList();
            if (checkbox.checked) {
              instance.handleDisplayStatus("Memory Saving Mode Enabled. The Effect will be Fully Active After a Page Refresh.");
            } else {
              instance.handleDisplayStatus("Memory Saving Mode Disabled. The Effect will be Fully Active After a Page Refresh.");
            }
          });
        }).buildElement()
      .buildElement()
    .buildElement();
}
