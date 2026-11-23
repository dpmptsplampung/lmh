import { expect } from "vitest";
import * as matchers from "@testing-library/jest-dom/matchers";
expect.extend(matchers);

// jsdom belum mengimplementasikan HTMLDialogElement.showModal/close. Stub ini meniru bagian yang dipakai komponen
// (atribut `open` dan event `close`); jebak fokus, inert, dan top layer asli tidak ditiru.
if (typeof HTMLDialogElement !== "undefined") {
  const proto = HTMLDialogElement.prototype as HTMLDialogElement;
  if (typeof proto.showModal !== "function") {
    proto.showModal = function showModal(this: HTMLDialogElement) {
      if (this.hasAttribute("open")) {
        throw new DOMException("Dialog sudah terbuka", "InvalidStateError");
      }
      this.setAttribute("open", "");
    };
  }
  if (typeof proto.close !== "function") {
    proto.close = function close(this: HTMLDialogElement) {
      if (!this.hasAttribute("open")) return;
      this.removeAttribute("open");
      this.dispatchEvent(new Event("close"));
    };
  }
}
