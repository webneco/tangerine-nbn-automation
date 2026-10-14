export type Salutation = 'Mr' | 'Mrs' | 'Ms' | 'Miss' | 'Dr';
export type AuState = 'NSW' | 'VIC' | 'QLD' | 'WA' | 'SA' | 'TAS' | 'ACT' | 'NT';
export type RouterModel = 'BYO Modem' | 'Amazon eero 7' | 'NetComm';

export interface MainAddress {
  /** Required. Typed into the autocomplete. */
  fullAddress: string;
  streetNumber?: string;
  /** Required when streetNumber is set. */
  streetName?: string;
  streetType?: string;
  suburb?: string;
  state?: AuState;
  postcode?: string;
  unitNumber?: string;
  country?: string;
}

export interface PaymentCard {
  cardNumber: string;
  cvv: string;
  /** MM/YY or MM/YYYY */
  expiry: string;
  nameOnCard: string;
}

export interface JobPayload {
  portal: { url: string };
  customer: {
    title: Salutation;
    firstName: string;
    lastName: string;
    email: string;
    /** AU mobile, e.g. 0412345678 */
    phone: string;
    /** DD/MM/YYYY */
    dateOfBirth: string;
  };
  connectionAddress: { mainAddress: MainAddress };
  plan: {
    /** Matched case-insensitively against button[data-product-name]. */
    name: string;
    speed?: string;
  };
  addOns: {
    router: {
      enabled: boolean;
      /** Required if enabled. */
      model?: RouterModel;
    };
  };
  connectionDetails?: {
    currentProvider?: string;
    avcId?: string;
    moveInDate?: string;
    movingProperty?: boolean;
  };
  /** "ASAP" | date string | blank */
  connectionDeliveryDate?: string;
  payment: {
    method?: string;
    card?: Partial<PaymentCard>;
  };
}
