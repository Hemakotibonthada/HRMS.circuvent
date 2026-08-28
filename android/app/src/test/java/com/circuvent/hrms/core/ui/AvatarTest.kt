package com.circuvent.hrms.core.ui

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * The fallback most people will actually see, since almost nobody has a
 * picture set.
 */
class AvatarTest {

    @Test
    fun `takes the first and last name`() {
        assertEquals("VN", initialsOf("Vema Naidu"))
    }

    @Test
    fun `skips an expanded middle initial`() {
        // Indian names frequently carry one. "Hema Koteswar Naidu" reading HK
        // would drop the family name, which is the part people are known by.
        assertEquals("HN", initialsOf("Hema Koteswar Naidu"))
    }

    @Test
    fun `one word gives one letter`() {
        // Better than inventing a second from the middle of the word.
        assertEquals("A", initialsOf("admin"))
    }

    @Test
    fun `tolerates the spacing a real record has`() {
        assertEquals("PS", initialsOf("  Priya   Sharma  "))
    }

    @Test
    fun `never returns nothing`() {
        // An empty circle reads as a failure to load. A question mark is at
        // least honest about not knowing.
        assertEquals("?", initialsOf(""))
        assertEquals("?", initialsOf("   "))
    }

    @Test
    fun `uppercases whatever it is given`() {
        assertEquals("VN", initialsOf("vema naidu"))
    }
}
