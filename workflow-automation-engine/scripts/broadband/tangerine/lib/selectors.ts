/**
 * Every selector used by the Tangerine journey.
 * Entries marked `// discovered from live DOM` were not in the spec and were
 * found by inspecting https://test-tangerine.hipeely.com (Oct 2026).
 */
export const SEL = {
  address: {
    input: '#autocomplete',
    searchResult: '#search-result',
    // Real suggestions carry data-id; "Sorry! Address Not Found" is a data-id-less placeholder.
    suggestion: '#search-result .autocomplete-suggestion[data-id]', // discovered from live DOM
    // Not rendered in the current build; when absent the portal's own addressManual() is invoked instead.
    enterManually: 'text=/Enter your address manually/i',
    nearlyPopup: '#address-nearly',
    nearlyOption: '#multi-address-wrap .multi-address-con', // discovered from live DOM
    loader: '#modal-loader', // discovered from live DOM
    manualSection: '#modal-ajax-result #manual-address',
    manual: {
      unitNo: '#unitno',
      streetNo: '#streetno',
      streetName: '#streetname',
      streetType: '#streettype',
      suburb: '#suburb',
      state: '#state',
      postcode: '#postcode',
      submit: '#manual-address-btn',
    },
    success: '[id^="address-success-"]',
    successWireless: '[id^="address-wireless-"]', // discovered from live DOM (#address-wireless-5 / -6)
    buildYourPlanText: 'Build Your Plan',
    buildYourPlanFallback: '.okbutton',
  },

  plan: {
    productButton: 'button[data-product-name]',
    speedButton: 'button[data-product-name][data-product-type="speed"]', // discovered from live DOM
    stickyCart: '#sticky-main-cart',
    cartMonthly: '#sticky-main-cart .total-monthly', // discovered from live DOM
    cartToday: '#sticky-main-cart .grand-total', // discovered from live DOM
  },

  popups: {
    userModel: '#user-model',
    accelerateGreat: '#accelerate-great',
    accelerateGreatBack: '#a2g_back_btn',
    equipmentUpgradeContinue: '#user-model button.coat_upgrade',
    noModemAgree: '#user-model a.btn-secondery',
    routerWithoutPlan: '#modem-select-withoutNBN',
  },

  router: {
    tabs: {
      eero: '#amazon-eero-7-tab',
      netcomm: '#netcomm-tab',
      byo: '#bring-your-own-modem-tab',
    },
    outrightButton: 'div[class*="payment_method_outright_choose_btn"] button[data-product-type="modem"]',
  },

  // Documented selector is `button.btnsm2.orderNow`; the live DOM uses `btn-sm2`
  // so both are listed (comma = either). // discovered from live DOM
  orderNow: 'button.btnsm2.orderNow, #sticky-main-cart button.btn-sm2.orderNow',

  login: {
    email: '#login_email',
    next: '#submit_email', // discovered from live DOM
    otp: '#otp_code',
  },

  contact: {
    salutation: '#salutation', // discovered from live DOM
    firstName: '#fname', // discovered from live DOM
    lastName: '#lname', // discovered from live DOM
    mobile: '#mobile', // discovered from live DOM
    dob: '#dob', // discovered from live DOM
    hearAboutUs: '#hear_about_us', // discovered from live DOM
    privacyPolicy: '#read_policy', // discovered from live DOM
    next: 'button.contactnext',
  },

  addressView: {
    useServiceAddress: '#address1',
    useServiceAddressLabel: 'label[for="address1"]', // discovered from live DOM
    delivery: {
      unitNo: '#send_eq_unitno', // discovered from live DOM
      streetNo: '#send_eq_streetno', // discovered from live DOM
      streetName: '#send_eq_streetaddess', // discovered from live DOM (sic)
      streetType: '#send_eq_street_type', // discovered from live DOM
      suburb: '#send_eq_town', // discovered from live DOM
      state: '#send_eq_state', // discovered from live DOM
      postcode: '#send_eq_postcode', // discovered from live DOM
    },
    selfCarePortal: '#print',
    selfCarePortalLabel: "label[for='print']",
    next: '#btn-address-transfer', // discovered from live DOM
  },

  transfer: {
    activationNew: 'input[name="new_or_transfer"][value="100000000"]', // discovered from live DOM
    activationTransfer: 'input[name="new_or_transfer"][value="100000001"]', // discovered from live DOM
    avcId: '#avc_id',
    avcCheck: 'button.avc-id-submit', // discovered from live DOM
    avcContainer: '.avcid-container', // discovered from live DOM
    avcProvideLater: '#avcidProvideLater',
    provider: '#new_or_transfer_provider',
    preferredDate: '#conntectiondate',
    activeNbnUnsure: '#radio-unsure', // discovered from live DOM
    activatingNbnYes: '#activating_nbn_yes',
    processOrder: '#btn-transfer-number', // discovered from live DOM
  },

  donate: {
    no: '#donate-no', // discovered from live DOM
    next: '#btn-address-transfer', // discovered from live DOM
  },

  payment: {
    nameOnCard: '#cardname', // discovered from live DOM
    panFrame: "iframe[src*='tillpayments.com/iframes/pan']",
    cvvFrame: "iframe[src*='tillpayments.com/iframes/cvv']",
    expiry: '#expriy_month', // discovered from live DOM (sic)
    pageCheckboxes: 'input[type="checkbox"][id^="checkbox"]', // discovered from live DOM (#checkbox1/29/3/7)
    payNow: '#till_pay_submit', // discovered from live DOM
    confirmModal: '#user-model:has(#payment_name_confirm)', // discovered from live DOM (two #user-model exist)
    confirmCheckboxes: '#payment_name_confirm, #payment_confirm_terms', // discovered from live DOM
    confirmPayNow: '#till_submit', // discovered from live DOM
    transactionId: '#transactionId',
  },
} as const;
