/**
 * What a plugin gets from `require('obsidian')`, plus the shared CodeMirror / Lezer packages
 * that plugins mark as external and expect the app to provide.
 * Names and behaviour follow the public obsidian.d.ts; only part of the API exists yet.
 */
import * as cmCommands from '@codemirror/commands'
import * as cmLanguage from '@codemirror/language'
import * as cmState from '@codemirror/state'
import * as cmView from '@codemirror/view'
import * as lezerCommon from '@lezer/common'
import * as lezerHighlight from '@lezer/highlight'
import moment from 'moment'
import 'moment/locale/uk.js'
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml'
import { Events } from '../../core/events.js'
import { MetadataCache } from '../../core/metadata/metadataCache.js'
import { getAllTags, parseFrontMatterAliases, parseFrontMatterEntry, parseFrontMatterStringArray, parseFrontMatterTags } from '../../core/metadata/tags.js'
import { FileSystemAdapter } from '../../core/vault/adapter.js'
import { normalizePath, TAbstractFile, TFile, TFolder } from '../../core/vault/files.js'
import { FileManager } from '../../core/vault/fileManager.js'
import { Vault } from '../../core/vault/vault.js'
import { Keymap, Scope } from '../commands.js'
import { Component, Plugin, PluginSettingTab } from '../component.js'
import { Editor } from '../editor/editor.js'
import { MarkdownView } from '../editor/markdownView.js'
import { EditorSuggest, PopoverSuggest } from '../editor/suggest.js'
import { editorInfoField, editorLivePreviewField, editorViewField } from '../editor/fields.js'
import { MarkdownRenderChild, MarkdownRenderer } from '../editor/render.js'
import { addIcon, getIcon, getIconIds, setIcon } from '../icons.js'
import { request, requestUrl } from '../request.js'
import {
  ButtonComponent, DropdownComponent, ExtraButtonComponent, Menu, MenuItem, Modal, Notice, Setting, TextAreaComponent, TextComponent, ToggleComponent,
} from '../ui.js'
import { FileView, ItemView, View, Workspace, WorkspaceLeaf } from '../workspace.js'

/** shortcut: claims an old API version so plugins skip newer calls we do not have; raise as the API grows. */
export const apiVersion = '1.0.0'

const cmp = (a: string, b: string) => {
  const pa = a.split('.').map(Number)
  const pb = b.split('.').map(Number)
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0)
  return 0
}

export function debounce<T extends unknown[]>(cb: (...args: T) => unknown, timeout = 0, resetTimer = false) {
  let timer: ReturnType<typeof setTimeout> | undefined
  let last: T
  const run = () => { timer = undefined; cb(...last) }
  const fn = (...args: T) => {
    last = args
    if (timer && !resetTimer) return fn
    clearTimeout(timer)
    timer = setTimeout(run, timeout)
    return fn
  }
  fn.cancel = () => { clearTimeout(timer); timer = undefined; return fn }
  fn.run = () => { if (timer) { clearTimeout(timer); run() } }
  return fn
}

// Obsidian gives plugins moment both as `obsidian.moment` and as `window.moment`, in the app's language
moment.locale('uk')
;(globalThis as { moment?: typeof moment }).moment = moment

const platform = typeof process !== 'undefined' ? process.platform : ''

export const obsidianModule = {
  apiVersion,
  requireApiVersion: (version: string) => cmp(apiVersion, version) >= 0,
  Platform: {
    isDesktop: true, isDesktopApp: true, isMobile: false, isMobileApp: false, isPhone: false, isTablet: false,
    isMacOS: platform === 'darwin', isWin: platform === 'win32', isLinux: platform === 'linux', isSafari: false,
  },
  Events, Component, Plugin, PluginSettingTab,
  TAbstractFile, TFile, TFolder, Vault, FileManager, FileSystemAdapter, MetadataCache, Workspace, WorkspaceLeaf,
  View, ItemView, FileView, MarkdownView, Editor, EditorSuggest, PopoverSuggest, Keymap, Menu, MenuItem, moment,
  editorInfoField, editorViewField, editorLivePreviewField, MarkdownRenderer, MarkdownRenderChild,
  Modal, Notice, Setting, TextComponent, TextAreaComponent, ToggleComponent, DropdownComponent, ButtonComponent, ExtraButtonComponent,
  normalizePath, parseYaml, stringifyYaml, getAllTags, parseFrontMatterAliases, parseFrontMatterEntry, parseFrontMatterStringArray, parseFrontMatterTags, Scope, setIcon, addIcon, getIcon, getIconIds, debounce, requestUrl, request,
  getLinkpath: (linktext: string) => linktext.split('#')[0],
}

export const hostModules: Record<string, unknown> = {
  obsidian: obsidianModule,
  '@codemirror/state': cmState,
  '@codemirror/view': cmView,
  '@codemirror/language': cmLanguage,
  '@codemirror/commands': cmCommands,
  '@lezer/common': lezerCommon,
  '@lezer/highlight': lezerHighlight,
}
