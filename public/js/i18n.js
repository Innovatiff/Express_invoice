// ---------------------------------------------------------------------------
// Bilingual labels — Spanish first, English second. Always both.
//
// This is NOT a language switcher. The shop serves a largely Spanish-speaking
// customer base while the paperwork, the suppliers and the carriers are in
// English, so every label on screen and on every printed document carries both
// languages at once, Spanish leading.
//
// Vocabulary is deliberately the same vocabulary Express Invoice used for the
// last ten years. Where Express Invoice said "Quote" this says
// "Cotización / Quote" — not "Estimate", not "Proposal". The owner should never
// have to translate their own habits.
// ---------------------------------------------------------------------------

export const DICT = {
  // ---- Application ----
  app_name: ['Facturación Express', 'Express Invoicing'],
  loading: ['Cargando…', 'Loading…'],
  saving: ['Guardando…', 'Saving…'],
  none: ['Ninguno', 'None'],
  all: ['Todos', 'All'],
  yes: ['Sí', 'Yes'],
  no: ['No', 'No'],
  ok: ['Aceptar', 'OK'],
  of: ['de', 'of'],
  and: ['y', 'and'],
  optional: ['opcional', 'optional'],
  required: ['requerido', 'required'],
  never: ['Nunca', 'Never'],

  // ---- Navigation / screens ----
  nav_home: ['Inicio', 'Home'],
  nav_invoices: ['Facturas', 'Invoices'],
  nav_quotes: ['Cotizaciones', 'Quotes'],
  nav_orders: ['Pedidos', 'Orders'],
  nav_payments: ['Pagos', 'Payments'],
  nav_customers: ['Clientes', 'Customers'],
  nav_items: ['Artículos', 'Items'],
  nav_recurring: ['Recurrentes', 'Recurring'],
  nav_statements: ['Estados de Cuenta', 'Statements'],
  nav_reports: ['Informes', 'Reports'],
  nav_import: ['Importar', 'Import'],
  nav_settings: ['Configuración', 'Settings'],
  nav_shortcuts: ['Atajos de Teclado', 'Keyboard Shortcuts'],
  nav_sales: ['Ventas', 'Sales'],
  nav_catalog: ['Catálogo', 'Catalog'],
  nav_tools: ['Herramientas', 'Tools'],

  // ---- Actions ----
  act_new: ['Nuevo', 'New'],
  act_new_invoice: ['Nueva Factura', 'New Invoice'],
  act_new_quote: ['Nueva Cotización', 'New Quote'],
  act_new_order: ['Nuevo Pedido', 'New Order'],
  act_new_customer: ['Nuevo Cliente', 'New Customer'],
  act_new_item: ['Nuevo Artículo', 'New Item'],
  act_new_payment: ['Registrar Pago', 'Record Payment'],
  act_save: ['Guardar', 'Save'],
  act_save_new: ['Guardar y Nuevo', 'Save & New'],
  act_save_close: ['Guardar y Cerrar', 'Save & Close'],
  act_cancel: ['Cancelar', 'Cancel'],
  act_close: ['Cerrar', 'Close'],
  act_delete: ['Eliminar', 'Delete'],
  act_edit: ['Editar', 'Edit'],
  act_view: ['Ver', 'View'],
  act_print: ['Imprimir', 'Print'],
  act_preview: ['Vista Previa', 'Preview'],
  act_email: ['Correo', 'Email'],
  act_search: ['Buscar', 'Search'],
  act_filter: ['Filtrar', 'Filter'],
  act_clear: ['Limpiar', 'Clear'],
  act_refresh: ['Actualizar', 'Refresh'],
  act_export_csv: ['Exportar CSV', 'Export CSV'],
  act_back: ['Volver', 'Back'],
  act_duplicate: ['Duplicar', 'Duplicate'],
  act_void: ['Anular', 'Void'],
  act_unvoid: ['Restaurar', 'Un-void'],
  act_convert_invoice: ['Convertir a Factura', 'Convert to Invoice'],
  act_convert_order: ['Convertir a Pedido', 'Convert to Order'],
  act_add_line: ['Agregar Línea', 'Add Line'],
  act_remove_line: ['Quitar Línea', 'Remove Line'],
  act_apply: ['Aplicar', 'Apply'],
  act_select: ['Seleccionar', 'Select'],
  act_add: ['Agregar', 'Add'],
  act_run: ['Generar', 'Run'],
  act_sign_in: ['Iniciar Sesión', 'Sign In'],
  act_sign_out: ['Cerrar Sesión', 'Sign Out'],
  act_mark_sent: ['Marcar como Enviada', 'Mark as Sent'],
  act_pay_full: ['Pagar Completo', 'Pay in Full'],
  act_recalculate: ['Recalcular', 'Recalculate'],

  // ---- Documents, shared ----
  doc_invoice: ['Factura', 'Invoice'],
  doc_quote: ['Cotización', 'Quote'],
  doc_order: ['Pedido', 'Order'],
  doc_payment: ['Pago', 'Payment'],
  doc_statement: ['Estado de Cuenta', 'Statement'],
  doc_receipt: ['Recibo', 'Receipt'],

  invoice_number: ['Número de Factura', 'Invoice Number'],
  quote_number: ['Número de Cotización', 'Quote Number'],
  order_number: ['Número de Pedido', 'Order Number'],
  payment_number: ['Número de Pago', 'Payment Number'],
  number: ['Número', 'Number'],

  date: ['Fecha', 'Date'],
  due_date: ['Fecha de Vencimiento', 'Due Date'],
  expiry_date: ['Válida Hasta', 'Valid Until'],
  date_from: ['Desde', 'From'],
  date_to: ['Hasta', 'To'],

  bill_to: ['Facturar A', 'Bill To'],
  ship_to: ['Enviar A', 'Ship To'],
  customer: ['Cliente', 'Customer'],
  terms: ['Términos', 'Terms'],
  po_number: ['Orden de Compra', 'PO Number'],
  sales_person: ['Vendedor', 'Sales Person'],
  reference: ['Referencia', 'Reference'],
  status: ['Estado', 'Status'],
  currency: ['Moneda', 'Currency'],

  // ---- Line items ----
  line_item: ['Artículo', 'Item'],
  line_code: ['Código', 'Code'],
  line_description: ['Descripción', 'Description'],
  line_qty: ['Cant.', 'Qty'],
  line_unit: ['Unidad', 'Unit'],
  line_price: ['Precio', 'Price'],
  line_discount: ['Desc. %', 'Disc. %'],
  line_taxable: ['Imp.', 'Tax'],
  line_amount: ['Importe', 'Amount'],

  // ---- Totals ----
  subtotal: ['Subtotal', 'Subtotal'],
  discount: ['Descuento', 'Discount'],
  shipping: ['Envío', 'Shipping'],
  tax: ['Impuesto', 'Tax'],
  total: ['Total', 'Total'],
  amount_paid: ['Monto Pagado', 'Amount Paid'],
  balance_due: ['Saldo Pendiente', 'Balance Due'],
  balance: ['Saldo', 'Balance'],
  amount: ['Monto', 'Amount'],
  grand_total: ['Total General', 'Grand Total'],

  // ---- Notes ----
  notes: ['Notas', 'Notes'],
  comments: ['Comentarios', 'Comments'],
  private_notes: ['Notas Privadas', 'Private Notes'],
  private_notes_hint: [
    'No se imprimen ni se envían al cliente.',
    'Never printed and never sent to the customer.',
  ],
  footer_message: ['Mensaje al Pie', 'Footer Message'],
  thank_you: ['¡Gracias por su preferencia!', 'Thank you for your business!'],

  // ---- Statuses ----
  st_draft: ['Borrador', 'Draft'],
  st_sent: ['Enviada', 'Sent'],
  st_open: ['Abierta', 'Open'],
  st_unpaid: ['Sin Pagar', 'Unpaid'],
  st_partial: ['Pago Parcial', 'Partially Paid'],
  st_paid: ['Pagada', 'Paid'],
  st_overdue: ['Vencida', 'Overdue'],
  st_void: ['Anulada', 'Void'],
  st_accepted: ['Aceptada', 'Accepted'],
  st_declined: ['Rechazada', 'Declined'],
  st_expired: ['Expirada', 'Expired'],
  st_converted: ['Convertida', 'Converted'],
  st_fulfilled: ['Completado', 'Fulfilled'],
  st_invoiced: ['Facturado', 'Invoiced'],
  st_cancelled: ['Cancelado', 'Cancelled'],
  st_credit: ['Saldo a Favor', 'Credit'],

  // ---- Customer fields ----
  cust_name: ['Nombre', 'Name'],
  cust_company: ['Empresa', 'Company'],
  cust_account: ['Cuenta', 'Account'],
  cust_contact: ['Contacto', 'Contact'],
  cust_address: ['Dirección', 'Address'],
  cust_address2: ['Dirección 2', 'Address 2'],
  cust_city: ['Ciudad', 'City'],
  cust_state: ['Estado / Provincia', 'State / Province'],
  cust_zip: ['Código Postal', 'ZIP / Postal Code'],
  cust_country: ['País', 'Country'],
  cust_phone: ['Teléfono', 'Phone'],
  cust_mobile: ['Celular', 'Mobile'],
  cust_email: ['Correo Electrónico', 'Email'],
  cust_tax_exempt: ['Exento de Impuesto', 'Tax Exempt'],
  cust_discount: ['Descuento Predeterminado %', 'Default Discount %'],
  cust_credit_limit: ['Límite de Crédito', 'Credit Limit'],
  cust_since: ['Cliente Desde', 'Customer Since'],
  cust_last_sale: ['Última Venta', 'Last Sale'],
  cust_total_sales: ['Ventas Totales', 'Total Sales'],
  cust_open_balance: ['Saldo Abierto', 'Open Balance'],

  // ---- Item fields ----
  item_code: ['Código', 'Code'],
  item_description: ['Descripción', 'Description'],
  item_price: ['Precio de Venta', 'Sale Price'],
  item_cost: ['Costo', 'Cost'],
  item_unit: ['Unidad', 'Unit'],
  item_category: ['Categoría', 'Category'],
  item_taxable: ['Gravable', 'Taxable'],
  item_qty_stock: ['Cantidad en Existencia', 'Quantity in Stock'],
  item_active: ['Activo', 'Active'],
  item_margin: ['Margen', 'Margin'],
  item_desc_hint: [
    'El IMEI y el número de serie van aquí, como texto libre — igual que siempre.',
    'IMEI and serial numbers go here as free text — exactly as they always have.',
  ],

  // ---- Payments ----
  pay_method: ['Forma de Pago', 'Payment Method'],
  pay_cash: ['Efectivo', 'Cash'],
  pay_check: ['Cheque', 'Check'],
  pay_card: ['Tarjeta', 'Card'],
  pay_transfer: ['Transferencia', 'Transfer'],
  pay_other: ['Otro', 'Other'],
  pay_applied_to: ['Aplicado A', 'Applied To'],
  pay_unapplied: ['Sin Aplicar', 'Unapplied'],
  pay_amount_received: ['Monto Recibido', 'Amount Received'],
  pay_apply_hint: [
    'Reparta el monto entre las facturas abiertas. Lo que sobre queda como saldo a favor del cliente.',
    'Spread the amount across open invoices. Anything left over stays as customer credit.',
  ],

  // ---- Recurring ----
  rec_frequency: ['Frecuencia', 'Frequency'],
  rec_weekly: ['Semanal', 'Weekly'],
  rec_biweekly: ['Quincenal', 'Every 2 Weeks'],
  rec_monthly: ['Mensual', 'Monthly'],
  rec_quarterly: ['Trimestral', 'Quarterly'],
  rec_yearly: ['Anual', 'Yearly'],
  rec_next_date: ['Próxima Fecha', 'Next Date'],
  rec_end_date: ['Fecha Final', 'End Date'],
  rec_active: ['Activa', 'Active'],
  rec_generate_now: ['Generar Ahora', 'Generate Now'],
  rec_due: ['Recurrentes Pendientes', 'Recurring Due'],

  // ---- Reports ----
  rep_sales_summary: ['Resumen de Ventas', 'Sales Summary'],
  rep_sales_by_customer: ['Ventas por Cliente', 'Sales by Customer'],
  rep_sales_by_item: ['Ventas por Artículo', 'Sales by Item'],
  rep_unpaid: ['Facturas Sin Pagar', 'Unpaid Invoices'],
  rep_aged: ['Antigüedad de Saldos', 'Aged Receivables'],
  rep_payments: ['Pagos Recibidos', 'Payments Received'],
  rep_tax: ['Informe de Impuestos', 'Tax Report'],
  rep_quote_conversion: ['Conversión de Cotizaciones', 'Quote Conversion'],
  rep_period: ['Período', 'Period'],
  rep_this_month: ['Este Mes', 'This Month'],
  rep_last_month: ['Mes Pasado', 'Last Month'],
  rep_this_quarter: ['Este Trimestre', 'This Quarter'],
  rep_this_year: ['Este Año', 'This Year'],
  rep_last_year: ['Año Pasado', 'Last Year'],
  rep_custom: ['Personalizado', 'Custom'],
  rep_current: ['Corriente', 'Current'],
  rep_1_30: ['1–30 días', '1–30 days'],
  rep_31_60: ['31–60 días', '31–60 days'],
  rep_61_90: ['61–90 días', '61–90 days'],
  rep_90_plus: ['Más de 90 días', 'Over 90 days'],
  rep_count: ['Cantidad', 'Count'],
  rep_no_rows: ['No hay datos para este período.', 'No data for this period.'],

  // ---- Settings ----
  set_business: ['Datos del Negocio', 'Business Details'],
  set_business_name: ['Nombre del Negocio', 'Business Name'],
  set_website: ['Sitio Web', 'Website'],
  set_tax_id: ['RNC / Identificación Fiscal', 'Tax ID'],
  set_logo: ['Logotipo', 'Logo'],
  set_logo_hint: [
    'Pegue una imagen o elija un archivo. Se guarda dentro del documento, no se sube a ningún servidor.',
    'Paste an image or pick a file. It is stored inside the document, never uploaded elsewhere.',
  ],
  set_tax: ['Impuestos', 'Taxes'],
  set_tax1_name: ['Nombre del Impuesto 1', 'Tax 1 Name'],
  set_tax1_rate: ['Tasa del Impuesto 1 %', 'Tax 1 Rate %'],
  set_tax2_name: ['Nombre del Impuesto 2', 'Tax 2 Name'],
  set_tax2_rate: ['Tasa del Impuesto 2 %', 'Tax 2 Rate %'],
  set_tax2_compound: ['Impuesto 2 se calcula sobre Subtotal + Impuesto 1', 'Tax 2 compounds on Subtotal + Tax 1'],
  set_tax_inclusive: ['Los precios ya incluyen impuesto', 'Prices already include tax'],
  set_numbering: ['Numeración', 'Numbering'],
  set_next_number: ['Próximo Número', 'Next Number'],
  set_prefix: ['Prefijo', 'Prefix'],
  set_padding: ['Dígitos', 'Digits'],
  set_numbering_hint: [
    'Ajuste el próximo número para continuar donde quedó Express Invoice.',
    'Set the next number to continue where Express Invoice left off.',
  ],
  set_defaults: ['Valores Predeterminados', 'Defaults'],
  set_default_terms: ['Términos Predeterminados', 'Default Terms'],
  set_default_due_days: ['Días para Vencimiento', 'Days Until Due'],
  set_quote_valid_days: ['Días de Validez de Cotización', 'Quote Valid For (days)'],
  set_currency_symbol: ['Símbolo de Moneda', 'Currency Symbol'],
  set_currency_code: ['Código de Moneda', 'Currency Code'],
  set_date_format: ['Formato de Fecha', 'Date Format'],
  set_account: ['Cuenta', 'Account'],
  set_uid: ['Su Identificador de Usuario (UID)', 'Your User ID (UID)'],
  set_change_password: ['Cambiar Contraseña', 'Change Password'],
  set_new_password: ['Nueva Contraseña', 'New Password'],
  set_data: ['Datos', 'Data'],
  set_backup: ['Respaldo Completo (JSON)', 'Full Backup (JSON)'],
  set_backup_hint: [
    'Descarga todo: clientes, artículos, facturas, cotizaciones, pedidos y pagos.',
    'Downloads everything: customers, items, invoices, quotes, orders and payments.',
  ],

  // ---- Import ----
  imp_title: ['Importar desde Express Invoice', 'Import from Express Invoice'],
  imp_what: ['Qué está importando', 'What you are importing'],
  imp_file: ['Archivo CSV', 'CSV File'],
  imp_map: ['Asignación de Columnas', 'Column Mapping'],
  imp_map_hint: [
    'Empareje cada columna de su archivo con un campo del sistema. Deje en blanco lo que no aplique.',
    'Match each column in your file to a field. Leave anything that does not apply blank.',
  ],
  imp_preview: ['Vista Previa', 'Preview'],
  imp_rows_found: ['Filas encontradas', 'Rows found'],
  imp_run: ['Importar Ahora', 'Import Now'],
  imp_dry_run: ['Solo Verificar', 'Check Only'],
  imp_done: ['Importación Terminada', 'Import Finished'],
  imp_created: ['Creados', 'Created'],
  imp_updated: ['Actualizados', 'Updated'],
  imp_skipped: ['Omitidos', 'Skipped'],
  imp_errors: ['Errores', 'Errors'],
  imp_group_hint: [
    'Las facturas con varias líneas deben repetir el número de factura en cada fila.',
    'Multi-line invoices must repeat the invoice number on every row.',
  ],

  // ---- Login ----
  login_title: ['Iniciar Sesión', 'Sign In'],
  login_email: ['Correo Electrónico', 'Email'],
  login_password: ['Contraseña', 'Password'],
  login_remember: ['Mantener sesión iniciada', 'Keep me signed in'],
  login_forgot: ['¿Olvidó su contraseña?', 'Forgot your password?'],
  login_reset_sent: [
    'Le enviamos un enlace para restablecer su contraseña.',
    'A password reset link is on its way.',
  ],
  login_failed: ['Correo o contraseña incorrectos.', 'Wrong email or password.'],

  // ---- Dashboard ----
  dash_today: ['Hoy', 'Today'],
  dash_month_sales: ['Ventas del Mes', 'Sales This Month'],
  dash_outstanding: ['Por Cobrar', 'Outstanding'],
  dash_overdue: ['Vencido', 'Overdue'],
  dash_open_quotes: ['Cotizaciones Abiertas', 'Open Quotes'],
  dash_recent_invoices: ['Facturas Recientes', 'Recent Invoices'],
  dash_recent_payments: ['Pagos Recientes', 'Recent Payments'],
  dash_quick: ['Acciones Rápidas', 'Quick Actions'],

  // ---- Messages ----
  msg_saved: ['Guardado.', 'Saved.'],
  msg_deleted: ['Eliminado.', 'Deleted.'],
  msg_no_results: ['Sin resultados.', 'No results.'],
  msg_empty_list: ['Todavía no hay nada aquí.', 'Nothing here yet.'],
  msg_confirm_delete: ['¿Eliminar definitivamente?', 'Delete permanently?'],
  msg_confirm_void: [
    'Anular deja la factura en el historial con total cero. ¿Continuar?',
    'Voiding keeps the invoice in history at zero. Continue?',
  ],
  msg_unsaved: [
    'Hay cambios sin guardar. ¿Salir de todos modos?',
    'You have unsaved changes. Leave anyway?',
  ],
  msg_pick_customer: ['Elija un cliente primero.', 'Pick a customer first.'],
  msg_need_line: ['Agregue al menos una línea.', 'Add at least one line.'],
  msg_not_found: ['No se encontró.', 'Not found.'],
  msg_offline: ['Sin conexión. Reintentando…', 'Offline. Retrying…'],
  msg_config_missing: [
    'Falta la configuración de Firebase. Edite public/js/firebase-config.js.',
    'Firebase configuration is missing. Edit public/js/firebase-config.js.',
  ],
  msg_over_applied: [
    'Está aplicando más de lo recibido.',
    'You are applying more than you received.',
  ],
  msg_converted_from: ['Convertida desde', 'Converted from'],

  // ---- Shortcuts help ----
  sc_global: ['En cualquier pantalla', 'Anywhere'],
  sc_lists: ['En las listas', 'In lists'],
  sc_editor: ['En facturas, cotizaciones y pedidos', 'In invoices, quotes and orders'],
  sc_grid: ['En la tabla de líneas', 'In the line grid'],
  sc_goto: ['Ir a…', 'Go to…'],
  sc_hint: [
    'Las teclas sueltas funcionan cuando no está escribiendo en un campo.',
    'Single-key shortcuts work when you are not typing in a field.',
  ],
};

/** Spanish text for a key. */
export function es(key) {
  const e = DICT[key];
  return e ? e[0] : key;
}

/** English text for a key. */
export function en(key) {
  const e = DICT[key];
  return e ? e[1] : key;
}

/** "Español / English" on one line — for buttons, sentences, page titles. */
export function T(key, sep = ' / ') {
  const e = DICT[key];
  if (!e) return key;
  return e[0] === e[1] ? e[0] : e[0] + sep + e[1];
}

/**
 * Stacked bilingual markup: Spanish on top, English beneath in a lighter tone.
 * Used for form labels, table headers and toolbar buttons, where a slash-joined
 * string would run too wide.
 */
export function bi(key) {
  const e = DICT[key];
  if (!e) return `<span class="bi"><span class="bi-es">${key}</span></span>`;
  if (e[0] === e[1]) return `<span class="bi"><span class="bi-es">${esc(e[0])}</span></span>`;
  return (
    `<span class="bi"><span class="bi-es">${esc(e[0])}</span>` +
    `<span class="bi-en">${esc(e[1])}</span></span>`
  );
}

/** Inline bilingual markup: "Español <span>English</span>" on one line. */
export function biInline(key) {
  const e = DICT[key];
  if (!e) return esc(key);
  if (e[0] === e[1]) return esc(e[0]);
  return `${esc(e[0])} <span class="bi-en-inline">${esc(e[1])}</span>`;
}

export function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[c]);
}
