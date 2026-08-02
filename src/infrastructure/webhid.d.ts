/**
 * Minimal WebHID type declarations.
 *
 * WebHID is not part of TypeScript's bundled DOM library, so the parts we
 * actually use are declared here rather than pulling in a dependency.
 * Spec: https://wicg.github.io/webhid/
 */

interface HIDReportItem {
  readonly isAbsolute?: boolean;
  readonly isArray?: boolean;
  readonly isConstant?: boolean;
  readonly isRange?: boolean;
  readonly hasNull?: boolean;
  /** 32-bit values: (usagePage << 16) | usage */
  readonly usages?: readonly number[];
  readonly usageMinimum?: number;
  readonly usageMaximum?: number;
  readonly reportSize?: number;
  readonly reportCount?: number;
  readonly logicalMinimum?: number;
  readonly logicalMaximum?: number;
}

interface HIDReportInfo {
  readonly reportId?: number;
  readonly items?: readonly HIDReportItem[];
}

interface HIDCollectionInfo {
  readonly usagePage?: number;
  readonly usage?: number;
  readonly children?: readonly HIDCollectionInfo[];
  readonly inputReports?: readonly HIDReportInfo[];
  readonly outputReports?: readonly HIDReportInfo[];
  readonly featureReports?: readonly HIDReportInfo[];
}

interface HIDInputReportEvent extends Event {
  readonly device: HIDDevice;
  readonly reportId: number;
  readonly data: DataView;
}

interface HIDDevice extends EventTarget {
  readonly opened: boolean;
  readonly vendorId: number;
  readonly productId: number;
  readonly productName: string;
  readonly collections: readonly HIDCollectionInfo[];
  open(): Promise<void>;
  close(): Promise<void>;
  addEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
  ): void;
  removeEventListener(
    type: "inputreport",
    listener: (event: HIDInputReportEvent) => void,
  ): void;
}

interface HIDDeviceFilter {
  vendorId?: number;
  productId?: number;
  usagePage?: number;
  usage?: number;
}

interface HID extends EventTarget {
  getDevices(): Promise<HIDDevice[]>;
  requestDevice(options: { filters: HIDDeviceFilter[] }): Promise<HIDDevice[]>;
}

interface Navigator {
  readonly hid?: HID;
}
