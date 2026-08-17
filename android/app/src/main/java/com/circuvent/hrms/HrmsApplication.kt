package com.circuvent.hrms

import android.app.Application

/**
 * Process entry point.
 *
 * Deliberately thin. Anything expensive here runs before the first frame on
 * every cold start, including the ones where the user only wanted to clock in
 * and is already walking through a door.
 */
class HrmsApplication : Application()
