import { Renderer2 } from '@angular/core';
/**
 * @license VirtualList v0.2.3
 * Based on Angular2-Virtual-Scroll: https://github.com/rintoj/angular2-virtual-scroll
 * (c) 2016 Rinto Jose (rintoj)
 * (c) 2017 Amin Paks <amin.pakseresht@hotmail.com>
 * License: MIT
 */
import {
  Component,
  ContentChildren,
  ElementRef,
  EventEmitter,
  HostBinding,
  HostListener,
  Input,
  OnChanges,
  OnDestroy,
  Output,
  QueryList,
  SimpleChanges,
  ViewChild,
  OnInit,
  NgZone
} from '@angular/core';
import 'rxjs/add/operator/filter';
import 'rxjs/add/operator/takeUntil';
import 'rxjs/add/operator/distinctUntilChanged';
import { Observable } from 'rxjs/Observable';
import { Subscription } from 'rxjs/Subscription';

import { ChangeEvent, Dimensions } from './types';
import { isNil, isNumber, isString, isArray, parseNumber } from './utils';

const DEFAULT_VISIBLE_CHILDREN = 6;


@Component({
  selector: 'virtual-list',
  moduleId: 'angularVirtualList',
  template: `
    <div class="total-padding" #shim></div>
    <div class="list-content" #content >
      <ng-content></ng-content>
    </div>
  `,
  styles: [`
    :host {
      display: block;
      overflow: hidden;
      overflow-y: auto;
      position: relative !important;
      -webkit-overflow-scrolling: touch;
    }
    .list-content {
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      position: absolute;
    }
    .total-padding {
      visibility: hidden;
    }
  `],
})
export class VirtualListComponent<T = any> implements OnChanges, OnInit, OnDestroy {

  topPadding: number;
  scrollHeight: number;
  protected previousStart: number;
  protected previousEnd: number;
  protected startupLoop = true;
  protected element: HTMLElement;
  protected storedItems: T[];
  protected itemsSubscription: Subscription;

  private _parentScroll: Element | Window;
  private disposeScrollHandler: () => void | undefined;
  private disposeResizeHandler: () => void | undefined;
  private refreshHandler = () => {
    this.refresh();
  };

   /** Cache of the last scroll height to prevent setting CSS when not needed. */
   private lastScrollHeight = -1;


  @Input()
  height: string;

  @Input()
  childWidth: number;

  @Input()
  childHeight: number;

  @Input()
  visibleChildren: number;

  @Input()
  bufferAmount = 0;

  @Output()
  start = new EventEmitter<ChangeEvent>();

  @Output()
  end = new EventEmitter<ChangeEvent>();

  @Output()
  update = new EventEmitter<T[]>();

  @Output()
  change = new EventEmitter<ChangeEvent>();

  @ViewChild('content')
  contentElementRef: ElementRef;

  @ContentChildren('virtualListChildElement')
  childrenRef: QueryList<ElementRef>;

  @HostBinding('style.height')
  heightStyle = '';

  @ViewChild('shim', { read: ElementRef })
  shimElementRef: ElementRef;


  @Input()
  set parentScroll(element: Element | Window) {
    if (this._parentScroll === element) {
      return;
    }
    this._parentScroll = element;
    this.addParentEventHandlers(this._parentScroll);
  }

  get parentScroll(): Element | Window {
    return this._parentScroll;
  }

  @Input()
  set source$(items$: Observable<T[]>) {
    if (items$ instanceof Observable) {
      this.itemsSubscription = items$
        .filter(list => isArray(list))
        .distinctUntilChanged()
        .subscribe(list => {
          this.previousStart = -1;
          this.previousEnd = -1;
          this.startupLoop = true;

          this.storedItems = list;

          this.refreshList();
        },
        (err) => {
          console.error('VirtualList::Error in source$ ->', err);
          this.storedItems = [];
          this.refreshList();
          this.itemsSubscription.unsubscribe();
        },
        () => {
          this.storedItems = [];
          this.refreshList();
          this.itemsSubscription.unsubscribe();
        });
    }
  }

  constructor(
    private readonly zone: NgZone,
    private readonly renderer: Renderer2,     
    element: ElementRef) {
    this.element = element.nativeElement;
  }

  ngOnInit() {
    if (!this.parentScroll) {
      this.addParentEventHandlers(this.element);
    }
  }

  protected hasItems(): boolean {
    return this.getItems().length > 0;
  }

  protected getItems(): T[] {
    if (isArray(this.storedItems)) {
      return this.storedItems;
    } else {
      return [];
    }
  }

  protected getHeight(): number {
    const value = parseNumber(this.heightStyle);
    if (!isNil(value)) {
      return value;
    } else {
      return -1;
    }
  }

  protected setHeight(dimensions?: Dimensions): boolean {
    if (isNil(this.height) || (isString(this.height) && this.height.toLowerCase() !== 'off')) {
      const explicitHeight = parseNumber(this.height);

      if (isNumber(explicitHeight) && explicitHeight > 0) {

        this.heightStyle = this.height + 'px';
        return true;
      } else {

        if (isNil(dimensions)) {
          dimensions = this.calculateDimensions();
        }
        if (this.hasItems()) {
          if (isNumber(dimensions.childHeight) && dimensions.childHeight > 0) {
            const count = isNumber(this.visibleChildren) && this.visibleChildren > 0 ? this.visibleChildren : DEFAULT_VISIBLE_CHILDREN;
            const height = dimensions.childHeight * count;
            const currentHeight = this.getHeight();
            if (height > 0 && currentHeight !== height) {
              this.heightStyle = height + 'px';
            }
            return true;
          }
        }
      }
    }

    this.heightStyle = '';
    return false;
  }


  private addParentEventHandlers(parentScroll: Element | Window) {
    this.removeParentEventHandlers();
    if (parentScroll) {
      this.zone.runOutsideAngular(() => {
        this.disposeScrollHandler =
          this.renderer.listen(parentScroll, 'scroll', this.refreshHandler);
        if (parentScroll instanceof Window) {
          this.disposeScrollHandler =
            this.renderer.listen('window', 'resize', this.refreshHandler);
        }
      });
    }
  }

  private removeParentEventHandlers() {
    if (this.disposeScrollHandler) {
      this.disposeScrollHandler();
      this.disposeScrollHandler = undefined;
    }
    if (this.disposeResizeHandler) {
      this.disposeResizeHandler();
      this.disposeResizeHandler = undefined;
    }
  }

  protected countItemsPerRow() {
    let offsetTop;
    let itemsPerRow;
    const children = this.contentElementRef.nativeElement.children;
    for (itemsPerRow = 0; itemsPerRow < children.length; itemsPerRow++) {
      if (offsetTop !== undefined && offsetTop !== children[itemsPerRow].offsetTop) {
        break;
      }
      offsetTop = children[itemsPerRow].offsetTop;
    }
    return itemsPerRow;
  }

  protected calculateDimensions(): Dimensions {
    let el: Element = this.parentScroll instanceof Window ? document.body : this.parentScroll || this.element.nativeElement;
    const content = this.contentElementRef.nativeElement;

    const items = this.getItems();
    const itemCount = items.length;
    const viewWidth = el.clientWidth;
    const viewHeight = el.clientHeight;

    let contentDimensions: { width: number; height: number };
    if (isNil(this.childWidth) || isNil(this.childHeight)) {
      let firstChild: Element;

      if (this.childrenRef.length > 0) {
        firstChild = this.childrenRef.first.nativeElement;
      } else {
        firstChild = content.children[0];
      }

      if (firstChild instanceof HTMLElement) {
        contentDimensions = firstChild.getBoundingClientRect();
      } else {
        contentDimensions = {
          width: viewWidth,
          height: viewHeight
        };
      }
    }
    const childWidth = this.childWidth || contentDimensions.width;
    const childHeight = this.childHeight || contentDimensions.height || 1;

    let itemsPerRow = Math.max(1, this.countItemsPerRow());
    const itemsPerRowByCalc = Math.max(1, Math.floor(viewWidth / childWidth));
    const itemsPerCol = Math.max(1, Math.floor(viewHeight / childHeight));
    const scrollTop = Math.max(0, el.scrollTop);
    const scrollHeight = childHeight * Math.ceil(itemCount / itemsPerRow);
    if (itemsPerCol === 1 && Math.floor(scrollTop / this.scrollHeight * itemCount) + itemsPerRowByCalc >= itemCount) {
      itemsPerRow = itemsPerRowByCalc;
    }

    if (scrollHeight !== this.lastScrollHeight) {
      this.renderer.setStyle(this.shimElementRef.nativeElement, 'height', `${scrollHeight}px`);
      this.lastScrollHeight = scrollHeight;
    }

    return {
      itemCount: itemCount,
      viewWidth: viewWidth,
      viewHeight: viewHeight,
      childWidth: childWidth,
      childHeight: childHeight,
      itemsPerRow: itemsPerRow,
      itemsPerCol: itemsPerCol,
      itemsPerRowByCalc: itemsPerRowByCalc,
      scrollHeight
    };
  }

  protected calculateItems(forceViewportUpdate: boolean = false) {
    const el = this.parentScroll instanceof Window ? document.body : this.parentScroll || this.element;

    let dimensions = this.calculateDimensions();
    const items = this.getItems();
    if (this.setHeight(dimensions)) {
      dimensions = this.calculateDimensions();
    }
    let offsetTop = this.getElementsOffset();

    this.scrollHeight = dimensions.childHeight * dimensions.itemCount / dimensions.itemsPerRow;
    if (this.element.scrollTop > this.scrollHeight) {
      this.element.scrollTop = this.scrollHeight;
    }

    const scrollTop = Math.max(0, el.scrollTop);
    const indexByScrollTop = scrollTop / this.scrollHeight * dimensions.itemCount / dimensions.itemsPerRow;
    let end = Math.min(dimensions.itemCount,
      Math.ceil(indexByScrollTop) * dimensions.itemsPerRow + dimensions.itemsPerRow * (dimensions.itemsPerCol + 1));

    let maxStartEnd = end;
    const modEnd = end % dimensions.itemsPerRow;
    if (modEnd) {
      maxStartEnd = end + dimensions.itemsPerRow - modEnd;
    }
    const maxStart = Math.max(0, maxStartEnd - dimensions.itemsPerCol * dimensions.itemsPerRow - dimensions.itemsPerRow);
    let start = Math.min(maxStart, Math.floor(indexByScrollTop) * dimensions.itemsPerRow);

    this.topPadding = dimensions.childHeight * Math.ceil(start / dimensions.itemsPerRow);

    start = Number.isNaN(start) ? -1 : start;
    end = Number.isNaN(end) ? -1 : end;
    start -= this.bufferAmount;
    start = Math.max(0, start);
    end += this.bufferAmount;
    end = Math.min(items.length, end);
    if (start !== this.previousStart || end !== this.previousEnd) {

      // update the scroll list
      this.update.emit(items.slice(start, end));

      // emit 'start' event
      if (start !== this.previousStart && this.startupLoop === false) {
        this.start.emit({ start, end });
      }

      // emit 'end' event
      if (end !== this.previousEnd && this.startupLoop === false) {
        this.end.emit({ start, end });
      }

      this.previousStart = start;
      this.previousEnd = end;

      if (this.startupLoop === true) {
        this.refreshList();
      } else {
        this.change.emit({ start, end });
      }

    } else if (this.startupLoop === true) {
      this.startupLoop = false;
      this.refreshList();
    }
  }

  refreshList() {
    requestAnimationFrame(() => this.calculateItems());
  }

  
  private getElementsOffset(): number {
    let offsetTop = 0;
    if (this.containerElementRef && this.containerElementRef.nativeElement) {
      offsetTop += this.containerElementRef.nativeElement.offsetTop;
    }
    if (this.parentScroll) {
      offsetTop += this.element.nativeElement.offsetTop;
    }
    return offsetTop;
  }

  scrollInto(item: T) {
    if (this.hasItems()) {
      const index: number = this.getItems().indexOf(item);
      if (index < 0 || index >= (this.storedItems || []).length) {
        return;
      }

      const dimensions = this.calculateDimensions();
      this.element.scrollTop = Math.floor(index / dimensions.itemsPerRow) * dimensions.childHeight;
      this.refreshList();
    }
  }

  @HostListener('scroll')
  onScrollEvent() {
    this.refreshList();
  }

  refresh(forceViewportUpdate: boolean = false) {
    this.zone.runOutsideAngular(() => {
      requestAnimationFrame(() => this.calculateItems(forceViewportUpdate));
    });
  }


  ngOnChanges(changes: SimpleChanges) {
    const { visibleChildren } = changes;

    if (!isNil(visibleChildren)) {
      if (visibleChildren.currentValue !== visibleChildren.previousValue || visibleChildren.firstChange) {
        window.setTimeout(() => this.calculateItems(), 100);
      }
    }
  }

  ngOnDestroy() {
    if (this.itemsSubscription instanceof Subscription) {
      this.itemsSubscription.unsubscribe();
    }
    this.removeParentEventHandlers();
  }
}
